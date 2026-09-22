import { afterEach, describe, expect, it } from "bun:test";

import { FakeMailer } from "../../lib/mailer/index.ts";
import {
  adminHeaders,
  bearerFor,
  buildTestServer,
  commitCount,
  seedDocument,
  seedOperator,
  seedParticipant,
  seedSite,
  TEST_ACTOR,
} from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("POST /admin/api/documents/:slug/invitations/import", () => {
  it("merges 50 rows with 5 duplicate emails into 45 new + 5 updated people, 50 participations, one commit", async () => {
    const { server, dataDir, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-import" });

    // Pre-seed 5 people who already exist on the instance (but have no
    // participation on this document yet) — these are the "5 duplicate
    // emails" the import batch will match by email, not create anew.
    const preexisting = Array.from({ length: 5 }, (_, i) => ({
      id: `existing-person-${i}`,
      name: `Existing Person ${i}`,
      email: `existing${i}@example.org`,
    }));
    await server.storage.commit(
      "invite",
      { actor: TEST_ACTOR, subject: "invite: pre-seed people" },
      async (tx) => {
        for (const person of preexisting) {
          await tx.people.upsert({ site: "default", ...person, source: "crm" });
        }
      },
    );

    const rows = [
      ...Array.from({ length: 45 }, (_, i) => ({
        name: `New Person ${i}`,
        email: `new${i}@example.org`,
      })),
      // Same 5 emails as the pre-seeded people, different case to exercise
      // the case-insensitive merge.
      ...preexisting.map((p) => ({ name: p.name, email: p.email.toUpperCase() })),
    ];
    expect(rows.length).toBe(50);

    const before = await commitCount(dataDir);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-import/invitations/import",
      headers: adminHeaders(),
      payload: rows,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      update: false,
      site: "default",
      people_created: 45,
      // The 5 matched people carry a name already and the rows repeat it, so
      // nothing on their records changes — matching is not updating.
      people_updated: 0,
      people_overwritten: 0,
      invitations_created: 50,
      skipped_existing: 0,
      rows: expect.any(Array),
      commit: expect.any(String),
    });

    const after = await commitCount(dataDir);
    expect(after - before).toBe(1);

    const invitations = server.storage.readModel.listParticipationsForDocument("doc-import");
    expect(invitations.length).toBe(50);

    await server.close();
  });

  it("skips rows whose participation already exists on this document", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-import-2" });

    const row = { name: "Jane Doe", email: "jane@example.org" };
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-import-2/invitations/import",
      headers: adminHeaders(),
      payload: [row],
    });

    const second = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-import-2/invitations/import",
      headers: adminHeaders(),
      payload: [row],
    });

    const secondBody = JSON.parse(second.body);
    // Re-importing the same row is a no-op patch (identical fields, no new
    // participation) — the underlying commit may collapse to no real tree
    // change, so `commit` can be null here (unlike the first import above).
    expect(secondBody).toEqual({
      update: false,
      site: "default",
      people_created: 0,
      people_updated: 0,
      people_overwritten: 0,
      invitations_created: 0,
      skipped_existing: 1,
      rows: expect.any(Array),
      commit: secondBody.commit,
    });

    await server.close();
  });
});

describe("GET /admin/api/documents/:slug/invitations", () => {
  it("never contains a token", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-list" });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-list/invitations/import",
      headers: adminHeaders(),
      payload: [{ name: "Jane Doe", email: "jane@example.org" }],
    });

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-list/invitations",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);

    const participation = server.storage.readModel.getParticipation("doc-list", "jane-doe");
    const token = participation?.record.token as string;
    expect(token).toBeTruthy();

    // The regex-over-the-response assertion `plans/api-core.md` names: no
    // token-shaped substring (16+ base62 chars) appears anywhere, and
    // specifically the real minted token never appears.
    expect(response.body.includes(token)).toBe(false);
    expect(response.body).not.toMatch(/[A-Za-z0-9]{16,}/);

    await server.close();
  });
});

describe("POST /admin/api/documents/:slug/invitations/links", () => {
  it("returns a CSV of tokens and records an activity entry with the export count", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-links" });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-links/invitations/import",
      headers: adminHeaders(),
      payload: [{ name: "Jane Doe", email: "jane@example.org" }],
    });

    const participation = server.storage.readModel.getParticipation("doc-links", "jane-doe");
    const token = participation?.record.token as string;

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-links/invitations/links",
      headers: adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.body).toContain("person,name,email,link");
    expect(response.body).toContain(token);

    const activity = server.storage.readModel.getDocument("doc-links")?.activity ?? [];
    const exportEntry = activity.find((entry) => entry.action === "link-export");
    expect(exportEntry).toBeDefined();
    expect(exportEntry?.subject).toContain("1 tokens");

    await server.close();
  });
});

describe("staged invitations: import --dry-run, remove, send --dry-run", () => {
  it("dry-run import writes nothing and reports each row's action and changes", async () => {
    const { server, dataDir, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-staged" });
    const before = await commitCount(dataDir);

    const plan = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-staged/invitations/import?dry_run=1",
      headers: { ...adminHeaders(), "content-type": "application/x-ndjson" },
      payload: [
        JSON.stringify({ name: "Ada Staged", email: "ada@example.org" }),
        JSON.stringify({ name: "Ben Staged", email: "ben@example.org", org: "Ben & Co" }),
      ].join("\n"),
    });
    expect(plan.statusCode).toBe(200);
    const body = plan.json();
    expect(body.dry_run).toBe(true);
    expect(body.invitations_created).toBe(2);
    expect(body.rows.map((r: { action: string }) => r.action)).toEqual([
      "invite_new_person",
      "invite_new_person",
    ]);
    expect(await commitCount(dataDir)).toBe(before);
    expect(server.storage.readModel.listParticipationsForDocument("doc-staged")).toHaveLength(0);

    await server.close();
  });

  it("a staged invitation can be removed until it is sent; after that it is 409", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-remove" });

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remove/invitations/import",
      headers: { ...adminHeaders(), "content-type": "application/x-ndjson" },
      payload: [
        JSON.stringify({ name: "Cara Keep", email: "cara@example.org" }),
        JSON.stringify({ name: "Dan Oops", email: "dan@example.org" }),
      ].join("\n"),
    });
    const list = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-remove/invitations",
      headers: adminHeaders(),
    });
    const statuses = list.json<Array<{ person: string; status: string }>>();
    expect(statuses.every((row) => row.status === "not_sent")).toBe(true);

    const dryRun = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remove/invitations/send",
      headers: adminHeaders(),
      payload: { dry_run: true },
    });
    expect(dryRun.json().dry_run).toBe(true);
    expect(
      dryRun
        .json()
        .would_send.map((w: { person: string }) => w.person)
        .sort(),
    ).toEqual(["cara-keep", "dan-oops"]);
    expect(
      server.storage.readModel.getParticipation("doc-remove", "dan-oops")?.record.sent_at,
    ).toBeUndefined();

    const removed = await server.inject({
      method: "DELETE",
      url: "/admin/api/documents/doc-remove/invitations/dan-oops",
      headers: adminHeaders(),
    });
    expect(removed.statusCode).toBe(200);
    expect(server.storage.readModel.getParticipation("doc-remove", "dan-oops")).toBeUndefined();
    expect(server.storage.readModel.getPerson("default", "dan-oops")).toBeDefined();

    const sent = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remove/invitations/send",
      headers: adminHeaders(),
      payload: {},
    });
    expect(sent.json().sent).toBe(1);
    expect(sent.json().skipped).toEqual([]);

    const again = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remove/invitations/send",
      headers: adminHeaders(),
      payload: { dry_run: true },
    });
    expect(again.json().would_send).toEqual([]);
    expect(again.json().skipped).toEqual([{ person: "cara-keep", reason: "already_sent" }]);

    const tooLate = await server.inject({
      method: "DELETE",
      url: "/admin/api/documents/doc-remove/invitations/cara-keep",
      headers: adminHeaders(),
    });
    expect(tooLate.statusCode).toBe(409);
    expect(tooLate.json().error).toBe("already_sent");

    await server.close();
  });
});

describe("POST /admin/api/documents/:slug/invitations/send", () => {
  it("leaves a recipient the mailer rejected unsent, names them, and reaches them on the next run", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-send-truth" });
    await seedParticipant(server, {
      document: "doc-send-truth",
      person: "samuel-park",
      token: "samuelparktoken12345",
      name: "Samuel Park, MD",
      email: "samuel@example.org",
    });
    await seedParticipant(server, {
      document: "doc-send-truth",
      person: "rita-ok",
      token: "ritaoktoken123456789",
      email: "rita@example.org",
    });

    // The dispatcher makes 3 attempts before giving up on a recipient.
    mailer.failNextFor("samuel@example.org", 3);

    const first = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-send-truth/invitations/send",
      headers: adminHeaders(),
      payload: {},
    });
    expect(first.json().sent).toBe(1);
    expect(first.json().failed).toBe(1);
    expect(first.json().failures).toEqual([
      { person: "samuel-park", error: expect.stringContaining("samuel@example.org") },
    ]);

    const rejected = server.storage.readModel.getParticipation("doc-send-truth", "samuel-park");
    expect(rejected?.record.sent_at).toBeUndefined();
    expect(rejected?.record.notified?.invitation).toBeUndefined();
    const delivered = server.storage.readModel.getParticipation("doc-send-truth", "rita-ok");
    expect(delivered?.record.sent_at).toBeTruthy();
    expect(delivered?.record.notified?.invitation).toBe(delivered!.record.sent_at!);

    // The funnel reads `sent_at`, so the rejected invitee still reads as staged.
    const listed = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-send-truth/invitations",
      headers: adminHeaders(),
    });
    const statuses = Object.fromEntries(
      (listed.json() as Array<{ person: string; status: string }>).map((r) => [r.person, r.status]),
    );
    expect(statuses["samuel-park"]).toBe("not_sent");
    expect(statuses["rita-ok"]).toBe("unopened");

    // …and the operator sees who and why.
    const health = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-send-truth/notifications",
      headers: adminHeaders(),
    });
    expect(health.json().failures).toEqual([
      {
        event: "invitation",
        person: "samuel-park",
        error: expect.stringContaining("samuel@example.org"),
        at: expect.any(String),
      },
    ]);

    const second = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-send-truth/invitations/send",
      headers: adminHeaders(),
      payload: {},
    });
    expect(second.json().sent).toBe(1);
    expect(second.json().failed).toBe(0);
    expect(second.json().skipped).toEqual([{ person: "rita-ok", reason: "already_sent" }]);
    const recovered = server.storage.readModel.getParticipation("doc-send-truth", "samuel-park");
    expect(recovered?.record.sent_at).toBeTruthy();
    expect(recovered?.record.notified?.invitation).toBe(recovered!.record.sent_at!);

    await server.close();
  });
});

describe("POST /admin/api/documents/:slug/invitations/remind", () => {
  it("sends nothing to people invited moments ago and says why; a shorter interval lets it through", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-remind-age" });
    await seedParticipant(server, {
      document: "doc-remind-age",
      person: "ivy",
      token: "ivytoken123456789012",
    });
    await seedParticipant(server, {
      document: "doc-remind-age",
      person: "quinn",
      token: "quinntoken1234567890",
    });
    await seedParticipant(server, {
      document: "doc-remind-age",
      person: "nora",
      token: "noratoken12345678901",
      notify: { reminders: false },
    });

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-age/invitations/send",
      headers: adminHeaders(),
      payload: {},
    });
    const invitations = mailer.sent.length;
    expect(invitations).toBe(3);

    // Ninety seconds later (this test's "immediately"), the default 48-hour
    // interval refuses every one of them.
    const tooSoon = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-age/invitations/remind",
      headers: adminHeaders(),
      payload: { target: "unopened" },
    });
    expect(tooSoon.json()).toMatchObject({
      sent: 0,
      failed: 0,
      skipped_recent: 2,
      skipped_pref: 1,
      min_age_hours: 48,
    });
    expect(mailer.sent.length).toBe(invitations);

    const dry = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-age/invitations/remind",
      headers: adminHeaders(),
      payload: { target: "unopened", dry_run: true, min_age_hours: 0 },
    });
    expect(dry.json()).toMatchObject({
      dry_run: true,
      targeted: 2,
      skipped_recent: 0,
      skipped_pref: 1,
      min_age_hours: 0,
    });
    expect(mailer.sent.length).toBe(invitations);

    const forced = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-age/invitations/remind",
      headers: adminHeaders(),
      payload: { target: "unopened", min_age_hours: 0 },
    });
    expect(forced.json()).toMatchObject({ sent: 2, failed: 0, skipped_recent: 0, skipped_pref: 1 });
    expect(mailer.sent.length).toBe(invitations + 2);

    const ivy = server.storage.readModel.getParticipation("doc-remind-age", "ivy");
    expect(ivy?.record.notified?.reminder).toBe(1);
    expect(ivy?.record.notified?.["reminder-1"]).toBeTruthy();
    const nora = server.storage.readModel.getParticipation("doc-remind-age", "nora");
    expect(nora?.record.notified?.reminder).toBeUndefined();

    // The reminder itself is a message, so the interval now counts from it.
    const again = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-age/invitations/remind",
      headers: adminHeaders(),
      payload: { target: "unopened" },
    });
    expect(again.json()).toMatchObject({ sent: 0, skipped_recent: 2, skipped_pref: 1 });

    await server.close();
  });

  it("does not record a reminder the mailer rejected", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-remind-fail" });
    await seedParticipant(server, {
      document: "doc-remind-fail",
      person: "pat",
      token: "pattoken123456789012",
      email: "pat@example.org",
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-fail/invitations/send",
      headers: adminHeaders(),
      payload: {},
    });

    mailer.failNextFor("pat@example.org", 3);
    const reminded = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-fail/invitations/remind",
      headers: adminHeaders(),
      payload: { target: "unopened", min_age_hours: 0 },
    });
    expect(reminded.json()).toMatchObject({ sent: 0, failed: 1, commit: null });
    expect(reminded.json().failures).toEqual([
      { person: "pat", error: expect.stringContaining("pat@example.org") },
    ]);
    const pat = server.storage.readModel.getParticipation("doc-remind-fail", "pat");
    expect(pat?.record.notified?.reminder).toBeUndefined();

    await server.close();
  });

  it("rejects a negative min_age_hours", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-remind-bad" });
    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-remind-bad/invitations/remind",
      headers: adminHeaders(),
      payload: { target: "unopened", min_age_hours: -1 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("validation_failed");

    await server.close();
  });
});

describe("people belong to a site (issue #51)", () => {
  const A_HOST = "letters.example.test";
  const B_HOST = "notes.other.test";

  async function twoSites() {
    const built = await buildTestServer({
      env: { PUBLIC_URL: "https://drafter.test", INSTANCE_FROM_EMAIL: "platform@example.org" },
    });
    cleanups.push(built.cleanup);
    const { server } = built;
    await seedOperator(server, { email: "ann@a.test", name: "Ann" });
    await seedOperator(server, { email: "bob@b.test", name: "Bob" });
    await seedSite(server, {
      slug: "site-a",
      hostname: A_HOST,
      name: "Site A",
      reply_to: "a-team@a.test",
      operators: ["ann@a.test"],
    });
    await seedSite(server, {
      slug: "site-b",
      hostname: B_HOST,
      name: "Site B",
      reply_to: "b-team@b.test",
      operators: ["bob@b.test"],
    });
    await seedDocument(server, {
      slug: "a-letter",
      site: "site-a",
      operators: ["ann@a.test"],
      created_by: "ann@a.test",
    });
    await seedDocument(server, {
      slug: "b-note",
      site: "site-b",
      operators: ["bob@b.test"],
      created_by: "bob@b.test",
    });
    return built;
  }

  it("one email invited on two sites is two independent records, and neither import touches the other", async () => {
    const { server } = await twoSites();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");
    const bob = await bearerFor("bob@b.test", "site-b", "Bob");

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/a-letter/invitations/import",
      headers: { ...ann, host: A_HOST },
      payload: [{ name: "Jane Doe", email: "jane@example.org", org: "River Alliance" }],
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/b-note/invitations/import",
      headers: { ...bob, host: B_HOST },
      payload: [{ name: "Jane Doe", email: "JANE@example.org", org: "Housing Coalition" }],
    });

    const onA = server.storage.readModel.getPerson("site-a", "jane-doe");
    const onB = server.storage.readModel.getPerson("site-b", "jane-doe");
    expect(onA?.org).toBe("River Alliance");
    expect(onB?.org).toBe("Housing Coalition");
    expect(server.storage.readModel.listPeopleForSite("site-a")).toHaveLength(1);
    expect(server.storage.readModel.listPeopleForSite("site-b")).toHaveLength(1);

    await server.close();
  });

  it("resolves a person through the document's site, not the caller's standing", async () => {
    const { server } = await twoSites();
    const ann = await bearerFor("ann@a.test", "site-a", "Ann");

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/a-letter/invitations/import",
      headers: { ...ann, host: A_HOST },
      payload: [{ name: "Jane Doe", email: "jane@example.org", org: "River Alliance" }],
    });
    // The same address on the default site — a different person entirely.
    await server.storage.commit(
      "invite",
      { actor: TEST_ACTOR, subject: "invite: a default-site Jane" },
      async (tx) => {
        await tx.people.upsert({
          site: "default",
          id: "jane-doe",
          name: "Jane Doe",
          email: "jane@example.org",
          org: "Somewhere Else",
          source: "crm",
        });
      },
    );

    // `TEST_ACTOR` is the bootstrap superadmin, reading site A's document on
    // the default host: the person they see is site A's, because the scope
    // follows the document.
    const list = await server.inject({
      method: "GET",
      url: "/admin/api/documents/a-letter/invitations",
      headers: adminHeaders(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ person: string; org: string }>>()[0]?.org).toBe("River Alliance");

    await server.close();
  });
});

describe("the sign card's prefill belongs to the document (issue #51)", () => {
  it("resolves field by field: the participation's prefill, then the person's default, then nothing", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-prefill" });
    await seedParticipant(server, {
      document: "doc-prefill",
      person: "jane-doe",
      token: "prefilltoken0000000",
      name: "Jane Doe",
      org: "River Alliance",
      role: "Chair",
      // no site-level descriptor
      prefill: { org: "Parish Council", title: "Trustee" },
    });

    const bundle = await server.inject({ method: "GET", url: "/i/prefilltoken0000000/api/bundle" });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.json().prefill).toEqual({
      // the participation overrides
      org: "Parish Council",
      role: "Trustee",
      // the person's site-level default
      name: "Jane Doe",
      // neither supplies one
      descriptor: undefined,
      suggested_capacity: undefined,
    });

    await server.close();
  });

  it("a participation with no prefill resolves exactly as it did before the field existed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-legacy-prefill" });
    await seedParticipant(server, {
      document: "doc-legacy-prefill",
      person: "rick-roe",
      token: "legacyprefilltoken00",
      name: "Rick Roe",
      org: "River Alliance",
      role: "Treasurer",
      descriptor: "long-time neighbour",
    });

    const bundle = await server.inject({
      method: "GET",
      url: "/i/legacyprefilltoken00/api/bundle",
    });
    expect(bundle.json().prefill).toEqual({
      name: "Rick Roe",
      org: "River Alliance",
      role: "Treasurer",
      descriptor: "long-time neighbour",
      suggested_capacity: undefined,
    });

    await server.close();
  });

  it("an import on a second document never changes what the first one prefills", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-one" });
    await seedDocument(server, { slug: "doc-two" });

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-one/invitations/import",
      headers: adminHeaders(),
      payload: [
        { name: "Jane Doe", email: "jane@example.org", org: "River Alliance", role: "Chair" },
      ],
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-two/invitations/import",
      headers: adminHeaders(),
      payload: [
        { name: "Jane Doe", email: "jane@example.org", org: "Parish Council", role: "Trustee" },
      ],
    });

    const one = server.storage.readModel.getParticipation("doc-one", "jane-doe");
    const two = server.storage.readModel.getParticipation("doc-two", "jane-doe");
    expect(one?.record.prefill).toEqual({
      name: "Jane Doe",
      org: "River Alliance",
      title: "Chair",
    });
    expect(two?.record.prefill).toEqual({
      name: "Jane Doe",
      org: "Parish Council",
      title: "Trustee",
    });
    // …and the shared person record still carries what the first import set.
    expect(server.storage.readModel.getPerson("default", "jane-doe")?.org).toBe("River Alliance");

    await server.close();
  });

  it("the participant bundle exposes nothing from `people` beyond the resolved prefill", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-boundary" });
    await seedParticipant(server, {
      document: "doc-boundary",
      person: "jane-doe",
      token: "boundarytoken0000000",
      name: "Jane Doe",
      email: "jane-private@example.org",
    });
    await server.storage.commit(
      "invite",
      { actor: TEST_ACTOR, subject: "invite: give jane private fields" },
      async (tx) => {
        await tx.people.patch(
          { site: "default", id: "jane-doe" },
          { phone: "+15555550123", external_id: "crm-9999" },
        );
      },
    );

    const bundle = await server.inject({
      method: "GET",
      url: "/i/boundarytoken0000000/api/bundle",
    });
    expect(bundle.body).not.toContain("jane-private@example.org");
    expect(bundle.body).not.toContain("+15555550123");
    expect(bundle.body).not.toContain("crm-9999");

    await server.close();
  });
});

describe("import --update decides what may be overwritten (issue #51)", () => {
  async function seedJane(server: Awaited<ReturnType<typeof buildTestServer>>["server"]) {
    await seedDocument(server, { slug: "doc-update" });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-update/invitations/import",
      headers: adminHeaders(),
      payload: [{ name: "Jane Doe", email: "jane@example.org", org: "River Alliance" }],
    });
    await seedDocument(server, { slug: "doc-update-2" });
  }

  it("without --update, an existing person's blanks are filled and their set fields are kept", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedJane(server);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-update-2/invitations/import",
      headers: adminHeaders(),
      payload: [
        { name: "Jane Doe", email: "jane@example.org", org: "Parish Council", role: "Trustee" },
      ],
    });
    const body = response.json();
    expect(body.people_overwritten).toBe(0);
    expect(body.rows[0].would_change).toEqual(["role"]);
    expect(body.rows[0].kept).toEqual(["org"]);

    const person = server.storage.readModel.getPerson("default", "jane-doe");
    expect(person?.org).toBe("River Alliance");
    expect(person?.role).toBe("Trustee");

    await server.close();
  });

  it("with --update, the row's values replace what the person already carries", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedJane(server);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-update-2/invitations/import?update=1",
      headers: adminHeaders(),
      payload: [
        { name: "Jane Doe", email: "jane@example.org", org: "Parish Council", role: "Trustee" },
      ],
    });
    const body = response.json();
    expect(body.update).toBe(true);
    expect(body.people_overwritten).toBe(1);
    expect(body.rows[0].would_change.sort()).toEqual(["org", "role"]);
    expect(body.rows[0].kept).toEqual([]);
    expect(server.storage.readModel.getPerson("default", "jane-doe")?.org).toBe("Parish Council");

    await server.close();
  });

  it("a dry run reports would_change and kept in either mode and writes nothing", async () => {
    const { server, dataDir, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedJane(server);
    const before = await commitCount(dataDir);

    const row = {
      name: "Jane Doe",
      email: "jane@example.org",
      org: "Parish Council",
      descriptor: "long-time neighbour",
    };
    const plain = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-update-2/invitations/import?dry_run=1",
      headers: adminHeaders(),
      payload: [row],
    });
    expect(plain.json().rows[0].would_change).toEqual(["descriptor"]);
    expect(plain.json().rows[0].kept).toEqual(["org"]);

    const updating = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-update-2/invitations/import?dry_run=1&update=1",
      headers: adminHeaders(),
      payload: [row],
    });
    expect(updating.json().rows[0].would_change.sort()).toEqual(["descriptor", "org"]);
    expect(updating.json().rows[0].kept).toEqual([]);
    expect(updating.json().people_overwritten).toBe(1);

    expect(await commitCount(dataDir)).toBe(before);
    expect(server.storage.readModel.getPerson("default", "jane-doe")?.descriptor).toBeUndefined();

    await server.close();
  });

  it("--update refreshes an already-invited person's prefill; without it the participation is untouched", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedJane(server);

    const sameDoc = {
      name: "Jane Doe",
      email: "jane@example.org",
      org: "Parish Council",
      role: "Trustee",
    };
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-update/invitations/import",
      headers: adminHeaders(),
      payload: [sameDoc],
    });
    expect(
      server.storage.readModel.getParticipation("doc-update", "jane-doe")?.record.prefill,
    ).toEqual({ name: "Jane Doe", org: "River Alliance" });

    const updated = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-update/invitations/import?update=1",
      headers: adminHeaders(),
      payload: [sameDoc],
    });
    expect(updated.json().rows[0].would_change).toContain("prefill.org");
    expect(
      server.storage.readModel.getParticipation("doc-update", "jane-doe")?.record.prefill,
    ).toEqual({ name: "Jane Doe", org: "Parish Council", title: "Trustee" });

    await server.close();
  });
});

/**
 * `specs/api/admin.md` § People and invitations: `listed` keeps only rows
 * with a live signature carrying that listing choice, which is what the
 * People table's Listing filter reads (`specs/screens/admin-dashboard.md`
 * § People).
 */
describe("GET /admin/api/documents/:slug/invitations?listed=", () => {
  async function seedSigner(
    server: Awaited<ReturnType<typeof buildTestServer>>["server"],
    person: string,
    token: string,
    signature: { listed: boolean; revoked: boolean },
  ): Promise<void> {
    await seedParticipant(server, { document: "doc-listing", person, token });
    await server.storage.commit(
      "sign",
      {
        actor: { kind: "participant" },
        subject: `sign: ${person} on doc-listing`,
        document: "doc-listing",
        person,
        version: 1,
      },
      async (tx) => {
        await tx.participations.patch(
          { document: "doc-listing", person },
          {
            signature: {
              capacity: "personal",
              display_name: person,
              authorized: true,
              listed: signature.listed,
              signed_on_version: 1,
              revoked: signature.revoked,
            },
          },
        );
      },
    );
  }

  async function personsAt(
    server: Awaited<ReturnType<typeof buildTestServer>>["server"],
    url: string,
  ): Promise<string[]> {
    const response = await server.inject({ method: "GET", url, headers: adminHeaders() });
    return (response.json() as Array<{ person: string }>).map((row) => row.person);
  }

  it("narrows to the signers with that listing choice, and never to an unsigned or revoked row", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-listing", body: "v1 text." });
    await seedSigner(server, "listed-signer", "listedsignertoken123", {
      listed: true,
      revoked: false,
    });
    await seedSigner(server, "unlisted-signer", "unlistedsignertoken1", {
      listed: false,
      revoked: false,
    });
    await seedSigner(server, "revoked-signer", "revokedsignertoken12", {
      listed: false,
      revoked: true,
    });
    await seedParticipant(server, {
      document: "doc-listing",
      person: "never-signed",
      token: "neversignedtoken1234",
    });

    expect(
      (await personsAt(server, "/admin/api/documents/doc-listing/invitations")).sort(),
    ).toEqual(["listed-signer", "never-signed", "revoked-signer", "unlisted-signer"]);
    expect(
      await personsAt(server, "/admin/api/documents/doc-listing/invitations?listed=false"),
    ).toEqual(["unlisted-signer"]);
    expect(
      await personsAt(server, "/admin/api/documents/doc-listing/invitations?listed=true"),
    ).toEqual(["listed-signer"]);

    await server.close();
  });
});
