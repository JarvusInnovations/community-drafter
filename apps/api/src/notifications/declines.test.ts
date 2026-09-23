import { afterEach, describe, expect, it } from "bun:test";

import type { FakeMailer } from "../lib/mailer/index.ts";
import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedParticipant,
} from "../routes/test-support.ts";
import { clockMessageRecipients } from "./triggers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const HOUR = 3_600_000;
const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

const DECLINER = "declinertoken12345678";
const LATE_SIGNER = "latesignertoken123456";
const READER = "readertoken1234567890";

/**
 * `specs/behaviors/notifications.md` § Sending: "A declined participant
 * hears nothing further about the clock or outcome." Three opened invitees
 * with every default preference on: one declines with a comment, one
 * declines and later signs, and one does nothing — the control that shows
 * each message actually went out.
 */
describe("a declined participant", () => {
  it("hears no clock or outcome mail, still gets their own receipt and disposition, and rejoins by signing", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fakeMailer = mailer as FakeMailer;
    const slug = "doc-declines";

    await seedDocument(server, {
      slug,
      comments_close_at: at(HOUR),
      signing_closes_at: at(48 * HOUR),
    });
    for (const [person, token] of [
      ["decliner", DECLINER],
      ["latesigner", LATE_SIGNER],
      ["reader", READER],
    ] as const) {
      await seedParticipant(server, {
        document: slug,
        person,
        token,
        first_opened_at: at(-HOUR),
      });
    }

    const to = (fragment: string): string[] =>
      fakeMailer.sent
        .filter((m) => m.subject.includes(fragment))
        .map((m) => m.to.email ?? "")
        .toSorted();

    // The decliner leaves a comment and declines with it.
    const draft = await server.inject({
      method: "POST",
      url: `/i/${DECLINER}/api/draft/comments`,
      payload: { version: 1, body: "Paragraph two overreaches.", client_id: "c-1" },
    });
    expect(draft.statusCode).toBe(200);
    const submitted = await server.inject({
      method: "POST",
      url: `/i/${DECLINER}/api/submit`,
      payload: { version: 1, judgement: "decline", pending: 0 },
    });
    expect(submitted.statusCode).toBe(200);
    const submission = submitted.json().submission as { id: string; comments: { id: string }[] };

    // The late signer declines with nothing to say (for now).
    const declined = await server.inject({
      method: "POST",
      url: `/i/${LATE_SIGNER}/api/decline`,
      payload: {},
    });
    expect(declined.statusCode).toBe(200);

    // Their own receipts still arrive.
    expect(to("we received your review")).toEqual([
      "decliner@example.org",
      "latesigner@example.org",
    ]);

    // A publish that disposes of the decliner's comment tells them so.
    const v2 = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/versions`,
      headers: adminHeaders(),
      payload: {
        body: "v2 text, paragraph two narrowed.",
        summary: "Narrowed paragraph two",
        dispositions: [
          { submission: submission.id, comment: submission.comments[0]?.id, outcome: "accepted" },
        ],
      },
    });
    expect(v2.statusCode).toBe(200);
    expect(to("your comments were addressed in version 2")).toEqual(["decliner@example.org"]);

    // Signing opens: only the reader hears it.
    await server.phaseObserver.tick();
    await server.storage.commit(
      "settings",
      { actor: { kind: "system" }, subject: `settings: ${slug} (into signing)`, document: slug },
      async (tx) => {
        await tx.documents.patch({ slug }, { comments_close_at: at(-1000) });
      },
    );
    await server.phaseObserver.tick();
    expect(to("signing is open")).toEqual(["reader@example.org"]);

    // closing-soon shares the clock audience; its own test below sends it.
    expect(clockMessageRecipients(server, slug)).toEqual(["reader"]);

    // An extension reaches the reader alone.
    const extend = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/schedule`,
      headers: adminHeaders(),
      payload: { signing_closes_at: at(72 * HOUR) },
    });
    expect(extend.statusCode).toBe(200);
    expect(to("schedule updated")).toEqual(["reader@example.org"]);

    // The late signer changes their mind: the signature replaces the decline.
    const signed = await server.inject({
      method: "POST",
      url: `/i/${LATE_SIGNER}/api/signature`,
      payload: { capacity: "personal", display_name: "Lee Signer" },
    });
    expect(signed.statusCode).toBe(200);

    // The final text: the new signer hears it, the decliner does not.
    const final = await server.inject({
      method: "POST",
      url: `/admin/api/documents/${slug}/versions`,
      headers: adminHeaders(),
      payload: { body: "final text", summary: "Final text", final: true },
    });
    expect(final.statusCode).toBe(200);
    expect(to("final version")).toEqual(["latesigner@example.org"]);

    // Closed: signers and non-decliners with phase_changes, never the decliner.
    await server.storage.commit(
      "settings",
      { actor: { kind: "system" }, subject: `settings: ${slug} (closed)`, document: slug },
      async (tx) => {
        await tx.documents.patch({ slug }, { signing_closes_at: at(-1000) });
      },
    );
    await server.phaseObserver.tick();
    expect(to("signing has closed")).toEqual(["latesigner@example.org", "reader@example.org"]);

    expect(
      fakeMailer.sent.filter((m) => m.to.email === "decliner@example.org").map((m) => m.subject),
    ).toEqual([
      expect.stringContaining("we received your review"),
      expect.stringContaining("your comments were addressed in version 2"),
    ]);

    await server.close();
  }, 20_000);
});

describe("closing-soon and a declined participant", () => {
  it("goes to the opened non-signer and not to the one who declined", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const slug = "doc-declines-soon";

    // A long window, already inside its 24-hour lead, whose signing-opened
    // went out well before the quiet period's six hours.
    await seedDocument(server, {
      slug,
      comments_close_at: at(-48 * HOUR),
      signing_closes_at: at(20 * HOUR),
    });
    for (const [person, token] of [
      ["decliner", DECLINER],
      ["reader", READER],
    ] as const) {
      await seedParticipant(server, {
        document: slug,
        person,
        token,
        first_opened_at: at(-72 * HOUR),
        notified: { "signing-opened": at(-47 * HOUR) },
      });
    }

    const declined = await server.inject({
      method: "POST",
      url: `/i/${DECLINER}/api/decline`,
      payload: {},
    });
    expect(declined.statusCode).toBe(200);

    await server.closingSoonScheduler.tick();
    expect(
      (mailer as FakeMailer).sent
        .filter((m) => m.subject.includes("closes soon"))
        .map((m) => m.to.email),
    ).toEqual(["reader@example.org"]);

    await server.close();
  });
});
