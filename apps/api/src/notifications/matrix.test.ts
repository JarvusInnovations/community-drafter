import { afterEach, describe, expect, it } from "bun:test";
import type { FastifyInstance } from "fastify";

import type { FakeMailer } from "../lib/mailer/index.ts";
import type { OutboundMessage } from "../lib/mailer/index.ts";
import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedParticipant,
} from "../routes/test-support.ts";

/**
 * `specs/behaviors/notifications.md` § Messages — one test per matrix row,
 * proving exactly who each message reaches, against one cast that has a
 * person in every segment (§ Segments):
 *
 * - `staged`: never sent (no segment)
 * - `unopened`: invited, never opened (U)
 * - `opened`: opened, undecided (O)
 * - `commenter`: opened, commented, undecided (O)
 * - `signer`: signed on the current version (S)
 * - `behind`: signed on v1 while v2 is current (S-behind)
 * - `conditional`: signed conditionally (C)
 * - `decliner`: declined (D)
 * - `remover`: removed their name (D)
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const CAST = [
  "staged",
  "unopened",
  "opened",
  "commenter",
  "signer",
  "behind",
  "conditional",
  "decliner",
  "remover",
] as const;
type Member = (typeof CAST)[number];
const token = (person: Member) => `${person}token`.padEnd(24, "x");
const emailOf = (person: Member) => `${person}@example.org`;

interface Stage {
  server: FastifyInstance;
  mailer: FakeMailer;
  slug: string;
}

/**
 * A document in its comment period with two versions (so `behind` is behind),
 * addressed to a named body, and the whole cast seeded. Seeding writes
 * records directly, so nothing is mailed while the stage is set.
 */
async function stage(opts: { phase?: "commenting" | "signing" } = {}): Promise<Stage> {
  const { server, cleanup, mailer } = await buildTestServer();
  cleanups.push(cleanup);
  const slug = "matrix-doc";
  const signing = opts.phase === "signing";
  await seedDocument(server, {
    slug,
    body: "Version one.",
    comments_close_at: signing ? at(-HOUR) : at(24 * HOUR),
    signing_closes_at: at(72 * HOUR),
    addressed_to: ["the State Board of Education"],
  });
  // v2, published without --notify-commenters: nobody is mailed.
  const publish = await server.inject({
    method: "POST",
    url: `/admin/api/documents/${slug}/versions`,
    headers: adminHeaders(),
    payload: { body: "Version two.", summary: "Second draft" },
  });
  expect(publish.statusCode).toBe(200);

  const sent = at(-48 * HOUR);
  const opened = at(-47 * HOUR);
  await seedParticipant(server, { document: slug, person: "staged", token: token("staged") });
  await seedParticipant(server, {
    document: slug,
    person: "unopened",
    token: token("unopened"),
    sent_at: sent,
  });
  for (const person of ["opened", "commenter", "decliner"] as const) {
    await seedParticipant(server, {
      document: slug,
      person,
      token: token(person),
      sent_at: sent,
      first_opened_at: opened,
    });
  }
  await seedParticipant(server, {
    document: slug,
    person: "signer",
    token: token("signer"),
    sent_at: sent,
    first_opened_at: opened,
    signature: { display_name: "Sam Signer", signed_on_version: 2 },
  });
  await seedParticipant(server, {
    document: slug,
    person: "behind",
    token: token("behind"),
    sent_at: sent,
    first_opened_at: opened,
    signature: { display_name: "Bea Behind", signed_on_version: 1 },
  });
  await seedParticipant(server, {
    document: slug,
    person: "conditional",
    token: token("conditional"),
    sent_at: sent,
    first_opened_at: opened,
    signature: { display_name: "Cory Conditional", conditional: true, signed_on_version: 2 },
  });
  await seedParticipant(server, {
    document: slug,
    person: "remover",
    token: token("remover"),
    sent_at: sent,
    first_opened_at: opened,
    signature: { display_name: "Rae Removed", revoked: true, signed_on_version: 1 },
  });
  // One submit commit per submission, carrying its `Submission` trailer —
  // the read model dates a submission (and so a position) from that commit.
  const submissions = [
    ["commenter", "comment", "Tighten the second paragraph."],
    ["decliner", "decline", "I can't support the third ask."],
    ["signer", "sign", "Small typo in the title."],
  ] as const;
  for (const [person, judgement, body] of submissions) {
    const id = `${person}-aaaa`;
    await server.storage.commit(
      "submit",
      {
        actor: { kind: "participant" },
        subject: `submit: ${person} on ${slug} v1 (${judgement})`,
        document: slug,
        person,
        submission: id,
        judgement,
        version: 1,
      },
      async (tx) => {
        await tx.submissions.upsert({
          document: slug,
          id,
          person,
          version: 1,
          state: "submitted",
          judgement,
          comments: [{ id: "c1", body }],
        });
      },
    );
  }
  const fake = mailer as FakeMailer;
  fake.sent.length = 0;
  return { server, mailer: fake, slug };
}

/** Participant mail only (operators get their own notices), as the set of cast members reached. */
function reached(mailer: FakeMailer, match?: (message: OutboundMessage) => boolean): Member[] {
  const members = new Set<Member>();
  for (const message of mailer.sent) {
    if (match && !match(message)) continue;
    const person = CAST.find((member) => emailOf(member) === message.to.email);
    if (person) members.add(person);
  }
  return [...members].sort();
}

const sorted = (people: Member[]) => [...people].sort();

async function timeTravel(server: FastifyInstance, slug: string, patch: Record<string, string>) {
  await server.storage.commit(
    "settings",
    { actor: { kind: "system" }, subject: `settings: ${slug} (test time travel)`, document: slug },
    async (tx) => {
      await tx.documents.patch({ slug }, patch);
    },
  );
}

describe("invitation", () => {
  it("reaches only the invitations never delivered", async () => {
    const { server, mailer, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/invitations/send`,
      headers: adminHeaders(),
      payload: { only_unsent: true },
    });
    expect(response.statusCode).toBe(200);
    expect(reached(mailer)).toEqual(["staged"]);
    await server.close();
  });
});

describe("state changes send nothing", () => {
  it("the comment period closing, signing closing, and an admin close mail nobody", async () => {
    const { server, mailer, slug } = await stage();
    await server.phaseObserver.tick();
    await timeTravel(server, slug, { comments_close_at: at(-1000) });
    await server.phaseObserver.tick();
    await timeTravel(server, slug, { signing_closes_at: at(-500) });
    await server.phaseObserver.tick();
    expect(server.storage.readModel.getDocument(slug)?.record.state).toBe("closed");
    expect(reached(mailer)).toEqual([]);
    await server.close();
  });

  it("docs close mails nobody", async () => {
    const { server, mailer, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/close`,
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(reached(mailer)).toEqual([]);
    await server.close();
  });
});

describe("signature-confirmation (receipt)", () => {
  it("reaches only the signer, and says what happens next: one confirm-call, then delivery", async () => {
    const { server, mailer } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/i/${token("opened")}/api/signature`,
      payload: { capacity: "personal", display_name: "Olive Opened", version: 2 },
    });
    expect(response.statusCode).toBe(200);
    expect(reached(mailer)).toEqual(["opened"]);
    const receipt = mailer.sent.find((m) => m.to.email === emailOf("opened"));
    expect(receipt?.subject).toContain("you signed");
    expect(receipt?.text).toContain(
      "If the text changes before it's delivered, we'll ask you once to confirm your signature.",
    );
    expect(receipt?.text).toContain(
      "We'll let you know when it's delivered to the State Board of Education.",
    );
    expect(receipt?.text).toMatch(/remove your name any time until /u);
    await server.close();
  });

  it("after delivery, promises neither a confirm-call nor a delivery message", async () => {
    const { server, mailer, slug } = await stage({ phase: "signing" });
    const delivered = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/delivered`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(delivered.statusCode).toBe(200);
    mailer.sent.length = 0;

    await server.inject({
      method: "POST",
      url: `/i/${token("opened")}/api/signature`,
      payload: { capacity: "personal", display_name: "Olive Opened", version: 2 },
    });
    const receipt = mailer.sent.find((m) => m.to.email === emailOf("opened"));
    expect(receipt?.text).toMatch(/It was delivered to the State Board of Education on /u);
    expect(receipt?.text).not.toContain("we'll ask you once to confirm");
    expect(receipt?.text).not.toContain("We'll let you know when it's delivered");
    await server.close();
  });
});

describe("revocation-confirmation (receipt)", () => {
  it("reaches only the person who removed their name, and offers to sign again", async () => {
    const { server, mailer } = await stage();
    const response = await server.inject({
      method: "DELETE",
      url: `/i/${token("signer")}/api/signature`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(reached(mailer)).toEqual(["signer"]);
    expect(mailer.sent[0]?.text).toContain("Sign again");
    await server.close();
  });
});

describe("listing-changed (receipt)", () => {
  it("reaches only the signer, and says to change it back if it wasn't them", async () => {
    const { server, mailer } = await stage();
    const response = await server.inject({
      method: "PATCH",
      url: `/i/${token("signer")}/api/signature`,
      payload: { display_name: "Samuel Signer" },
    });
    expect(response.statusCode).toBe(200);
    expect(reached(mailer)).toEqual(["signer"]);
    expect(mailer.sent[0]?.text).toContain("If you didn't make this change");
    await server.close();
  });
});

describe("review-receipt", () => {
  it("a comment submission reaches its author and names when comments close", async () => {
    const { server, mailer } = await stage();
    await server.inject({
      method: "POST",
      url: `/i/${token("opened")}/api/draft/comments`,
      payload: { version: 2, body: "One more thought.", client_id: "k-1" },
    });
    const response = await server.inject({
      method: "POST",
      url: `/i/${token("opened")}/api/submit`,
      payload: { version: 2, judgement: "comment", pending: 0 },
    });
    expect(response.statusCode).toBe(200);
    expect(reached(mailer)).toEqual(["opened"]);
    expect(mailer.sent[0]?.text).toMatch(/You can add more comments until /u);
    await server.close();
  });

  it("a decline reaches the decliner and names when signing closes", async () => {
    const { server, mailer } = await stage({ phase: "signing" });
    const response = await server.inject({
      method: "POST",
      url: `/i/${token("opened")}/api/decline`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(reached(mailer)).toEqual(["opened"]);
    expect(mailer.sent[0]?.text).toMatch(/You can still sign until /u);
    await server.close();
  });

  it("a signing submission sends one combined receipt: the signing receipt, mentioning the comments", async () => {
    const { server, mailer } = await stage();
    await server.inject({
      method: "POST",
      url: `/i/${token("opened")}/api/draft/comments`,
      payload: { version: 2, body: "Signing, with a note.", client_id: "k-2" },
    });
    const response = await server.inject({
      method: "POST",
      url: `/i/${token("opened")}/api/submit`,
      payload: {
        version: 2,
        judgement: "sign",
        pending: 0,
        signature: { capacity: "personal", display_name: "Olive Opened" },
      },
    });
    expect(response.statusCode).toBe(200);
    const toO = mailer.sent.filter((m) => m.to.email === emailOf("opened"));
    expect(toO).toHaveLength(1);
    expect(toO[0]?.subject).toContain("you signed");
    expect(toO[0]?.text).toContain("We received your 1 comment too.");
    await server.close();
  });
});

describe("reminder", () => {
  it("--target unopened reaches U; opened-not-acted reaches the opened; each names the deadline and the ask", async () => {
    const { server, mailer, slug } = await stage({ phase: "signing" });
    const unopened = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/invitations/remind`,
      headers: adminHeaders(),
      payload: { target: "unopened", min_age_hours: 0 },
    });
    expect(unopened.statusCode).toBe(200);
    expect(reached(mailer)).toEqual(["unopened"]);
    expect(mailer.sent[0]?.text).toMatch(/Signing closes .+\. Sign or decline\./u);

    mailer.sent.length = 0;
    await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/invitations/remind`,
      headers: adminHeaders(),
      payload: { target: "opened_not_acted", min_age_hours: 0 },
    });
    // `commenter` has commented (status `commented`), so the existing target
    // leaves them out; the decliner, the remover and every signer never are.
    expect(reached(mailer)).toEqual(["opened"]);
    await server.close();
  });
});

describe("schedule-changed", () => {
  it("an extension without --notify sends nothing and says how many it would have told", async () => {
    const { server, mailer, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/schedule`,
      headers: adminHeaders(),
      payload: { signing_closes_at: at(96 * HOUR) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().notify).toEqual({ requested: false, would_notify: 2 });
    expect(reached(mailer)).toEqual([]);
    await server.close();
  });

  it("--dry-run writes and sends nothing", async () => {
    const { server, mailer, slug } = await stage();
    const before = server.storage.readModel.getDocument(slug)?.record.signing_closes_at;
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/schedule`,
      headers: adminHeaders(),
      payload: { signing_closes_at: at(96 * HOUR), notify: true, dry_run: true },
    });
    expect(response.json()).toMatchObject({
      dry_run: true,
      notify: { requested: true, would_notify: 2 },
    });
    expect(server.storage.readModel.getDocument(slug)?.record.signing_closes_at).toBe(before);
    expect(reached(mailer)).toEqual([]);
    await server.close();
  });

  it("--notify reaches O only, says there is more time, and a later --notify reaches them again", async () => {
    const { server, mailer, slug } = await stage();
    const first = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/schedule`,
      headers: adminHeaders(),
      payload: { signing_closes_at: at(96 * HOUR), notify: true },
    });
    expect(first.json().notify).toMatchObject({ requested: true, would_notify: 2, sent: 2 });
    expect(reached(mailer)).toEqual(sorted(["opened", "commenter"]));
    expect(mailer.sent[0]?.text).toMatch(/More time on .+: signing now closes .+ \(it was .+\)\./u);

    mailer.sent.length = 0;
    await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/schedule`,
      headers: adminHeaders(),
      payload: { signing_closes_at: at(120 * HOUR), notify: true },
    });
    expect(reached(mailer)).toEqual(sorted(["opened", "commenter"]));
    await server.close();
  });
});

describe("disposition-v<n>", () => {
  const dispositions = [
    { submission: "commenter-aaaa", comment: "c1", outcome: "accepted" },
    { submission: "decliner-aaaa", comment: "c1", outcome: "declined", note: "The ask stays." },
    { submission: "signer-aaaa", comment: "c1", outcome: "accepted" },
  ];

  it("publishing without --notify-commenters mails nobody and reports how many it would have told", async () => {
    const { server, mailer, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/versions`,
      headers: adminHeaders(),
      payload: { body: "Version three.", summary: "Third draft", dispositions },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().notified).toEqual({
      commenters: { requested: false, would_notify: 3 },
    });
    expect(reached(mailer)).toEqual([]);
    await server.close();
  });

  it("with --notify-commenters reaches the answered authors — decliners and signers included — and nobody else", async () => {
    const { server, mailer, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/versions`,
      headers: adminHeaders(),
      payload: {
        body: "Version three.",
        summary: "Third draft",
        dispositions,
        notify_commenters: true,
      },
    });
    expect(response.json().notified.commenters).toMatchObject({
      requested: true,
      would_notify: 3,
      sent: 3,
    });
    expect(reached(mailer)).toEqual(sorted(["decliner", "commenter", "signer"]));
    expect(mailer.sent[0]?.text).toContain("See what changed");
    await server.close();
  });
});

describe("confirm-call", () => {
  it("--dry-run lists S-behind and C, and sends nothing", async () => {
    const { server, mailer, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/confirm-call`,
      headers: adminHeaders(),
      payload: { dry_run: true },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.dry_run).toBe(true);
    expect(
      body.would_send.map((row: { person: string; reason: string }) => [row.person, row.reason]),
    ).toEqual(
      expect.arrayContaining([
        ["behind", "behind"],
        ["conditional", "conditional"],
      ]),
    );
    expect(body.would_send).toHaveLength(2);
    expect(reached(mailer)).toEqual([]);
    await server.close();
  });

  it("reaches S-behind and C once, records Action: confirm-call, and links the comparison", async () => {
    const { server, mailer, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/confirm-call`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sent: 2,
      failed: 0,
      commit: `confirm-call: ${slug} (2 signers)`,
    });
    expect(reached(mailer)).toEqual(sorted(["conditional", "behind"]));
    const behind = mailer.sent.find((m) => m.to.email === emailOf("behind"));
    expect(behind?.subject).toContain("the text changed since you signed");
    expect(behind?.text).toContain("history/compare?from=1&to=2");
    expect(behind?.text).toContain("Keep or remove my name");
    const conditional = mailer.sent.find((m) => m.to.email === emailOf("conditional"));
    expect(conditional?.subject).toContain("please confirm your conditional signature");

    const activity = server.storage.readModel.listActivitySince(slug, at(-HOUR));
    expect(activity.some((entry) => entry.action === "confirm-call")).toBe(true);
    await server.close();
  });

  it("Keep my name clears the drift and the condition, so a second call reaches nobody and says so", async () => {
    const { server, mailer, slug } = await stage();
    for (const person of ["behind", "conditional"] as const) {
      const keep = await server.inject({
        method: "PATCH",
        url: `/i/${token(person)}/api/signature`,
        payload: { confirm: true },
      });
      expect(keep.statusCode).toBe(200);
      expect(keep.json()).toMatchObject({ conditional: false, signed_on_version: 2 });
    }
    // Re-affirming sends nothing.
    expect(reached(mailer)).toEqual([]);

    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/confirm-call`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.json()).toMatchObject({ sent: 0, commit: null });
    expect(reached(mailer)).toEqual([]);
    await server.close();
  });
});

describe("delivered", () => {
  it("is refused before signing opens", async () => {
    const { server, slug } = await stage();
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/delivered`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("phase_closed");
    await server.close();
  });

  it("records delivered_at, reaches every current signer once, and a second call is 409 already_delivered", async () => {
    const { server, mailer, slug } = await stage({ phase: "signing" });
    const dry = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/delivered`,
      headers: adminHeaders(),
      payload: { dry_run: true },
    });
    expect(dry.json() as unknown).toEqual({ dry_run: true, would_send: 3 });
    expect(server.storage.readModel.getDocument(slug)?.record.delivered_at).toBeUndefined();

    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/delivered`,
      headers: adminHeaders(),
      payload: { note: "Handed over at the board meeting." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sent: 3,
      delivered_note: "Handed over at the board meeting.",
    });
    const record = server.storage.readModel.getDocument(slug)?.record;
    expect(record?.delivered_at).toBeDefined();
    expect(reached(mailer)).toEqual(sorted(["conditional", "signer", "behind"]));
    const message = mailer.sent.find((m) => m.to.email === emailOf("signer"));
    expect(message?.subject).toContain("delivered");
    expect(message?.text).toMatch(/was delivered to the State Board of Education on /u);
    expect(message?.text).toContain("Handed over at the board meeting.");

    const again = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/delivered`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already_delivered");
    await server.close();
  });

  it("a confirm-call after delivery is refused", async () => {
    const { server, slug } = await stage({ phase: "signing" });
    await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/delivered`,
      headers: adminHeaders(),
      payload: {},
    });
    const response = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/confirm-call`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("already_delivered");
    await server.close();
  });
});
