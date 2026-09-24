import { afterEach, describe, expect, it } from "bun:test";
import type { FastifyInstance } from "fastify";

import type { FakeMailer } from "../lib/mailer/index.ts";
import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedOperator,
  seedParticipant,
  seedSite,
  TEST_ACTOR,
} from "../routes/test-support.ts";
import { sendOperatorDigest } from "./operator-digest.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

const TODAY = "2026-09-20";
const SINCE = "2026-09-19T00:00:00.000Z";

/** A delivered invitation and a first open, as the records themselves record them. */
async function markReached(
  server: FastifyInstance,
  document: string,
  person: string,
): Promise<void> {
  await server.storage.commit(
    "send",
    { actor: { kind: "system" }, subject: `send: invitation for ${document}`, document },
    async (tx) => {
      await tx.participations.patch(
        { document, person },
        {
          sent_at: new Date().toISOString(),
          first_opened_at: new Date().toISOString(),
          notified: { invitation: new Date().toISOString() },
        },
      );
    },
  );
}

async function sign(
  server: FastifyInstance,
  document: string,
  person: string,
  displayName: string,
): Promise<void> {
  await server.storage.commit(
    "sign",
    { actor: { kind: "participant" }, subject: `sign: ${person} on ${document}`, document, person },
    async (tx) => {
      await tx.participations.patch(
        { document, person },
        {
          signature: {
            capacity: "personal",
            display_name: displayName,
            authorized: true,
            listed: true,
            signed_on_version: 1,
            revoked: false,
          },
        },
      );
    },
  );
}

function digests(mailer: FakeMailer) {
  return mailer.sent.filter((message) => message.subject.includes("today's activity"));
}

describe("operator digest", () => {
  /** `specs/behaviors/notifications.md` § Operator digest — a busy day. */
  it("reports the day's invitations, opens, signatures and declines to the document's operators", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;

    await seedDocument(server, { slug: "doc-busy", title: "Coalition Charter" });
    await seedParticipant(server, {
      document: "doc-busy",
      person: "jane-doe",
      name: "Jane Doe",
      token: "n".repeat(20),
    });
    await seedParticipant(server, {
      document: "doc-busy",
      person: "rick-roe",
      name: "Rick Roe",
      token: "o".repeat(20),
    });

    await markReached(server, "doc-busy", "jane-doe");
    await sign(server, "doc-busy", "jane-doe", "Jane Doe");
    await server.storage.commit(
      "submit",
      {
        actor: { kind: "participant" },
        subject: "submit: rick-roe on doc-busy (decline)",
        document: "doc-busy",
        person: "rick-roe",
        judgement: "decline",
        submission: "rick-roe-aaaa",
      },
      async (tx) => {
        await tx.submissions.upsert({
          document: "doc-busy",
          id: "rick-roe-aaaa",
          person: "rick-roe",
          version: 1,
          state: "submitted",
          judgement: "decline",
          comments: [],
        });
      },
    );

    const document = server.storage.readModel.getDocument("doc-busy")!;
    const sent = await sendOperatorDigest(server, document, TODAY, SINCE);
    expect(sent).toBe(true);

    const message = digests(fake)[0];
    expect(message?.to.email).toBe(TEST_ACTOR.email);
    expect(message?.subject).toBe("Coalition Charter — today's activity");
    expect(message?.text).toContain("1 invitation delivered");
    expect(message?.text).toContain("1 person opened the document for the first time");
    expect(message?.text).toContain("1 signature added: Jane Doe");
    expect(message?.text).toContain("1 decline");
    // Display names only — no address from `people` reaches operator mail.
    expect(message?.text).not.toContain("jane-doe@example.org");

    const after = server.storage.readModel.getDocument("doc-busy");
    expect(after?.record.operator_notified?.digest).toBe(TODAY);
    // Recording the digest touches the document record, and a commit that
    // does not change the body is not a version
    // (`specs/data-model.md` § Versions).
    expect(after?.versions.length).toBe(document.versions.length);

    // Twice on the same day is once.
    expect(await sendOperatorDigest(server, after!, TODAY, SINCE)).toBe(false);
    expect(digests(fake).length).toBe(1);

    await server.close();
  });

  it("sends nothing and records nothing on a quiet day", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;

    await seedDocument(server, { slug: "doc-quiet" });
    await seedParticipant(server, {
      document: "doc-quiet",
      person: "jane-doe",
      token: "p".repeat(20),
    });

    const document = server.storage.readModel.getDocument("doc-quiet")!;
    expect(await sendOperatorDigest(server, document, TODAY, SINCE)).toBe(false);
    expect(digests(fake).length).toBe(0);
    expect(
      server.storage.readModel.getDocument("doc-quiet")?.record.operator_notified,
    ).toBeUndefined();

    await server.close();
  });

  /**
   * § Operator mail: delivery is logged and nowhere else, and a refusal
   * never becomes a thrown request. § "A sent count is a delivery count":
   * a day nobody was reached is not recorded as sent.
   */
  it("logs a refused delivery, records nothing, and never enters the dispatcher's failure list", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;

    await seedDocument(server, { slug: "doc-refused" });
    await seedParticipant(server, {
      document: "doc-refused",
      person: "jane-doe",
      token: "q".repeat(20),
    });
    await markReached(server, "doc-refused", "jane-doe");
    fake.failNextFor(TEST_ACTOR.email, 5);

    const document = server.storage.readModel.getDocument("doc-refused")!;
    expect(await sendOperatorDigest(server, document, TODAY, SINCE)).toBe(false);
    expect(
      server.storage.readModel.getDocument("doc-refused")?.record.operator_notified,
    ).toBeUndefined();
    expect(server.notifications.failureList("doc-refused").length).toBe(0);

    await server.close();
  });

  /** `specs/behaviors/sites.md` § Mail: the document's site owns the From line and the tag. */
  it("sends from the document's site, with its tag and its host in the link", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;

    await seedSite(server, {
      slug: "coalition",
      hostname: "sign.coalition.test",
      name: "The Coalition",
      sender_email: "hello@coalition.test",
      reply_to: "team@coalition.test",
    });
    await seedDocument(server, { slug: "doc-site", site: "coalition" });
    await seedParticipant(server, {
      document: "doc-site",
      person: "jane-doe",
      token: "r".repeat(20),
    });
    await markReached(server, "doc-site", "jane-doe");

    const document = server.storage.readModel.getDocument("doc-site")!;
    expect(await sendOperatorDigest(server, document, TODAY, SINCE)).toBe(true);

    const message = digests(fake)[0];
    expect(message?.from.email).toBe("hello@coalition.test");
    expect(message?.from.name).toBe("The Coalition");
    expect(message?.replyTo).toBe("team@coalition.test");
    expect(message?.tag).toBe("coalition");
    expect(message?.text).toContain("https://sign.coalition.test/admin/d/doc-site");
    // An operator message never carries a personal-link token.
    expect(message?.text).not.toContain("r".repeat(20));

    await server.close();
  });

  it("goes to every active operator of the document and to no deactivated one", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;

    await seedOperator(server, { email: "ann@example.org", name: "Ann" });
    await seedOperator(server, { email: "gone@example.org", name: "Gone", active: false });
    await seedDocument(server, {
      slug: "doc-operators",
      operators: [TEST_ACTOR.email, "ann@example.org", "gone@example.org"],
    });
    await seedParticipant(server, {
      document: "doc-operators",
      person: "jane-doe",
      token: "s".repeat(20),
    });
    await markReached(server, "doc-operators", "jane-doe");

    const document = server.storage.readModel.getDocument("doc-operators")!;
    await sendOperatorDigest(server, document, TODAY, SINCE);

    const recipients = digests(fake).map((message) => message.to.email);
    expect(recipients).toContain(TEST_ACTOR.email);
    expect(recipients).toContain("ann@example.org");
    expect(recipients).not.toContain("gone@example.org");

    await server.close();
  });
});

describe("first-response notices", () => {
  /** § Operator digest: once each per document, the moment they happen. */
  it("announces the first signature exactly once, through the sign event", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;

    await seedDocument(server, { slug: "doc-first", title: "Coalition Charter" });
    await seedParticipant(server, {
      document: "doc-first",
      person: "jane-doe",
      name: "Jane Doe",
      token: "t".repeat(20),
    });
    await seedParticipant(server, {
      document: "doc-first",
      person: "rick-roe",
      name: "Rick Roe",
      token: "u".repeat(20),
    });

    await sign(server, "doc-first", "jane-doe", "Jane Doe");
    await server.events.publish({
      type: "sign",
      document: "doc-first",
      person: "jane-doe",
      commit: "",
    });

    const notices = () =>
      fake.sent.filter((message) => message.subject === "Coalition Charter — first signature");
    expect(notices().length).toBe(1);
    expect(notices()[0]?.to.email).toBe(TEST_ACTOR.email);
    expect(notices()[0]?.text).toContain("Jane Doe is the first person to sign");
    expect(
      server.storage.readModel.getDocument("doc-first")?.record.operator_notified?.first_signature,
    ).toBeTruthy();

    // The second signature is not the first one.
    await sign(server, "doc-first", "rick-roe", "Rick Roe");
    await server.events.publish({
      type: "sign",
      document: "doc-first",
      person: "rick-roe",
      commit: "",
    });
    expect(notices().length).toBe(1);

    await server.close();
  });

  it("sends no first-comment notice: comments reach the team in the digest", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;

    await seedDocument(server, { slug: "doc-comment", title: "Coalition Charter" });
    await seedParticipant(server, {
      document: "doc-comment",
      person: "rick-roe",
      name: "Rick Roe",
      token: "v".repeat(20),
    });
    await server.inject({
      method: "POST",
      url: `/i/${"v".repeat(20)}/api/draft/comments`,
      payload: { version: 1, body: "A thought.", client_id: "k-1" },
    });
    const submitted = await server.inject({
      method: "POST",
      url: `/i/${"v".repeat(20)}/api/submit`,
      payload: { version: 1, judgement: "comment", pending: 0 },
    });
    expect(submitted.statusCode).toBe(200);

    expect(fake.sent.filter((message) => message.to.email === TEST_ACTOR.email)).toHaveLength(0);
    expect(
      server.storage.readModel.getDocument("doc-comment")?.record.operator_notified?.first_comment,
    ).toBeUndefined();

    await server.close();
  });
});

describe("operator digest: the day signing closed", () => {
  it("reports signing closed, the confirm-call and the delivery", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fake = mailer as FakeMailer;
    const hour = 3_600_000;

    await seedDocument(server, {
      slug: "doc-closing",
      title: "Coalition Charter",
      body: "One.",
      comments_close_at: new Date(Date.now() - hour).toISOString(),
      signing_closes_at: new Date(Date.now() + 48 * hour).toISOString(),
      addressed_to: ["the Board"],
    });
    await seedParticipant(server, {
      document: "doc-closing",
      person: "jane-doe",
      name: "Jane Doe",
      token: "w".repeat(20),
      signature: { display_name: "Jane Doe", conditional: true, signed_on_version: 1 },
    });
    const call = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-closing/confirm-call",
      headers: adminHeaders(),
      payload: {},
    });
    expect(call.json().sent).toBe(1);
    const delivered = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-closing/delivered",
      headers: adminHeaders(),
      payload: {},
    });
    expect(delivered.statusCode).toBe(200);
    await server.storage.commit(
      "close",
      { actor: { kind: "system" }, subject: "close: doc-closing", document: "doc-closing" },
      async (tx) => {
        await tx.documents.patch(
          { slug: "doc-closing" },
          { state: "closed", signing_closes_at: new Date(Date.now() - 1000).toISOString() },
        );
      },
    );

    const document = server.storage.readModel.getDocument("doc-closing")!;
    const since = new Date(Date.now() - 2 * hour).toISOString();
    expect(await sendOperatorDigest(server, document, TODAY, since)).toBe(true);
    const message = digests(fake)[0];
    expect(message?.text).toMatch(/- Signing closed /u);
    expect(message?.text).toContain("- Confirm-call sent to 1 signer");
    expect(message?.text).toMatch(/- Delivered to the Board on /u);

    await server.close();
  });
});
