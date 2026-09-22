import { afterEach, describe, expect, it } from "bun:test";

import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedParticipant,
} from "../routes/test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("publishing sends v<n> to every_revision subscribers exactly once", () => {
  it("sends v3 to alice (every_revision) and not to bob (default off); nothing left to retry", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-v3", body: "v1 text" });
    await seedParticipant(server, {
      document: "doc-v3",
      person: "alice",
      token: "alicetoken1234567890",
      notify: { every_revision: true },
    });
    await seedParticipant(server, {
      document: "doc-v3",
      person: "bob",
      token: "bobtoken1234567890ab",
    });

    // seedDocument's initial body is v1; two publishes make v2 and v3.
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-v3/versions",
      headers: adminHeaders(),
      payload: { body: "v2 text", summary: "Second draft" },
    });
    const publish3 = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-v3/versions",
      headers: adminHeaders(),
      payload: { body: "v3 text", summary: "Third draft" },
    });
    expect(publish3.statusCode).toBe(200);
    expect(publish3.json().number).toBe(3);

    const fakeMailer = mailer as import("../lib/mailer/index.ts").FakeMailer;
    const v3Messages = fakeMailer.sent.filter((m) => m.subject.includes("version 3 published"));
    expect(v3Messages.length).toBe(1);
    expect(v3Messages[0]?.to.email).toBe("alice@example.org");

    const alice = server.storage.readModel.getParticipation("doc-v3", "alice");
    expect(alice?.record.notified?.v3).toBeTruthy();
    const bob = server.storage.readModel.getParticipation("doc-v3", "bob");
    expect(bob?.record.notified?.v3).toBeUndefined();

    // Nothing failed, so nothing is left for `retry` to re-dispatch.
    const retry = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-v3/notifications/retry",
      headers: adminHeaders(),
      payload: {},
    });
    expect(retry.json().retried).toBe(0);

    await server.close();
  });
});

/**
 * `specs/behaviors/notifications.md` § Sending: "A current signer is told
 * nothing about the clock at all" — and § Messages keeps `final-published`
 * forced on for them, whatever their preferences say.
 */
describe("a current signer with every optional preference off", () => {
  it("hears final-published, and nothing about the window opening or closing", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const farFuture = new Date(Date.now() + 30 * 3_600_000).toISOString();
    await seedDocument(server, {
      slug: "doc-forced",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: farFuture,
    });
    await seedParticipant(server, {
      document: "doc-forced",
      person: "signer",
      token: "signertoken1234567890",
      // Opened, so the only thing keeping them out of the clock audience is
      // the signature itself.
      first_opened_at: new Date(Date.now() - 60_000).toISOString(),
      notify: {
        every_revision: false,
        daily_digest: false,
        phase_changes: false,
        my_comments_addressed: false,
        reminders: false,
      },
    });

    // Sign while still in the commenting phase.
    await server.inject({
      method: "POST",
      url: "/i/signertoken1234567890/api/signature",
      payload: { capacity: "personal", display_name: "Sam Signer" },
    });

    // Observe the commenting phase once (so the phase observer has a
    // baseline), then simulate time passing into the signing phase.
    await server.phaseObserver.tick();
    await server.storage.commit(
      "settings",
      {
        actor: { kind: "system" },
        subject: "settings: doc-forced (test time travel)",
        document: "doc-forced",
      },
      async (tx) => {
        await tx.documents.patch(
          { slug: "doc-forced" },
          { comments_close_at: new Date(Date.now() - 1000).toISOString() },
        );
      },
    );
    await server.phaseObserver.tick();

    const fakeMailer = mailer as import("../lib/mailer/index.ts").FakeMailer;
    expect(fakeMailer.sent.filter((m) => m.subject.includes("signing is open")).length).toBe(0);

    // Move signing_closes_at within the 24h closing-soon window and tick.
    await server.storage.commit(
      "settings",
      {
        actor: { kind: "system" },
        subject: "settings: doc-forced (closing soon)",
        document: "doc-forced",
      },
      async (tx) => {
        await tx.documents.patch(
          { slug: "doc-forced" },
          { signing_closes_at: new Date(Date.now() + 23 * 3_600_000).toISOString() },
        );
      },
    );
    await server.closingSoonScheduler.tick();
    expect(fakeMailer.sent.filter((m) => m.subject.includes("closes soon")).length).toBe(0);

    // Publish a final version — forced `final-published` for the signer.
    const publish = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-forced/versions",
      headers: adminHeaders(),
      payload: { body: "final text", summary: "Final text", final: true },
    });
    expect(publish.statusCode).toBe(200);
    const finalPublished = fakeMailer.sent.filter((m) =>
      m.subject.includes("final version published"),
    );
    expect(finalPublished.length).toBe(1);
    expect(finalPublished[0]?.to.email).toBe("signer@example.org");

    await server.close();
  });
});

describe("signature and revocation confirmations", () => {
  it("are sent regardless of preferences and contain the personal link", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-confirm",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-confirm",
      person: "jane-doe",
      token: "confirmtoken1234567890",
      notify: {
        every_revision: false,
        daily_digest: false,
        phase_changes: false,
        my_comments_addressed: false,
        reminders: false,
      },
    });

    await server.inject({
      method: "POST",
      url: "/i/confirmtoken1234567890/api/signature",
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    const fakeMailer = mailer as import("../lib/mailer/index.ts").FakeMailer;
    const signed = fakeMailer.sent.filter((m) => m.subject.includes("you signed"));
    expect(signed.length).toBe(1);
    expect(signed[0]?.text).toContain("/i/confirmtoken1234567890");

    await server.inject({
      method: "DELETE",
      url: "/i/confirmtoken1234567890/api/signature",
      payload: { reason: "changed my mind" },
    });
    const revoked = fakeMailer.sent.filter((m) => m.subject.includes("signature was removed"));
    expect(revoked.length).toBe(1);
    expect(revoked[0]?.text).toContain("/i/confirmtoken1234567890");
    expect(revoked[0]?.text).toContain("changed my mind");

    await server.close();
  });
});

describe("MAILER=export", () => {
  it("invitations/send marks notified.invitation and the dispatcher's export mailer records the row", async () => {
    const { ExportMailer } = await import("../lib/mailer/index.ts");
    const exportMailer = new ExportMailer();
    const { server, cleanup } = await buildTestServer({ mailer: exportMailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-export" });
    await seedParticipant(server, {
      document: "doc-export",
      person: "jane-doe",
      token: "exporttoken1234567890",
    });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-export/invitations/send",
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().csv).toContain("name,email,subject,link");
    expect(response.json().csv).toContain("jane-doe@example.org");

    const participation = server.storage.readModel.getParticipation("doc-export", "jane-doe");
    expect(participation?.record.notified?.invitation).toBeTruthy();

    const rows = exportMailer.peek();
    expect(rows.length).toBe(1);
    expect(rows[0]?.email).toBe("jane-doe@example.org");
    expect(rows[0]?.link).toContain("/i/exporttoken1234567890");

    await server.close();
  });
});

describe("failed sends and retry", () => {
  it("a failed send retries 3 times, shows up as failed, and `retry` re-dispatches it", async () => {
    const { FakeMailer } = await import("../lib/mailer/index.ts");
    const fakeMailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer: fakeMailer });
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-fail",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-fail",
      person: "jane-doe",
      token: "failtoken1234567890ab",
      email: "jane@example.org",
    });

    fakeMailer.failNextFor("jane@example.org", 3);
    await server.inject({
      method: "POST",
      url: "/i/failtoken1234567890ab/api/signature",
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    const status = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-fail/notifications",
      headers: adminHeaders(),
    });
    expect(status.json().failed).toBe(1);

    const retry = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-fail/notifications/retry",
      headers: adminHeaders(),
      payload: {},
    });
    expect(retry.json().retried).toBe(1);
    expect(retry.json().sent).toBe(1);
    // The confirmation the retry delivered, plus the operators'
    // first-signature notice (`specs/behaviors/notifications.md`
    // § Operator digest), which is operator mail and was never in the
    // dispatcher's failure bucket to retry.
    expect(fakeMailer.sent.filter((m) => m.to.email === "jane@example.org").length).toBe(1);
    expect(fakeMailer.sent.length).toBe(2);

    const statusAfter = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-fail/notifications",
      headers: adminHeaders(),
    });
    expect(statusAfter.json().failed).toBe(0);

    await server.close();
  });
});

describe("daily digest", () => {
  it("sends once per day for a person with both every_revision and daily_digest, and omits versions already sent as v<n>", async () => {
    process.env.INSTANCE_TIMEZONE = "UTC";
    process.env.INSTANCE_DIGEST_HOUR = String(new Date().getUTCHours());
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-digest", body: "v1 text" });
    await seedParticipant(server, {
      document: "doc-digest",
      person: "carol",
      token: "digesttoken1234567890",
      notify: { every_revision: true, daily_digest: true },
    });

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-digest/versions",
      headers: adminHeaders(),
      payload: { body: "v2 text", summary: "Second draft" },
    });

    const fakeMailer = mailer as import("../lib/mailer/index.ts").FakeMailer;
    expect(fakeMailer.sent.some((m) => m.subject.includes("version 2 published"))).toBe(true);

    await server.digestScheduler.tick();
    const digest = fakeMailer.sent.filter((m) => m.subject.includes("daily summary"));
    expect(digest.length).toBe(1);
    // The digest omits v2 — carol already got it via `every_revision`.
    expect(digest[0]?.text).not.toContain("Version 2:");

    const participation = server.storage.readModel.getParticipation("doc-digest", "carol");
    expect(participation?.record.notified?.digest).toBeTruthy();

    // A second tick the same "day" is a no-op.
    await server.digestScheduler.tick();
    expect(fakeMailer.sent.filter((m) => m.subject.includes("daily summary")).length).toBe(1);

    await server.close();
  });
});

/**
 * Issue #71 — `specs/behaviors/document-lifecycle.md` § Extension: an
 * extension is "announced to subscribers of phase changes with old and new
 * times", and `specs/behaviors/notifications.md` § Content rules spells out
 * the line. End-to-end: extend → event carries the previous values →
 * dispatcher formats them → the message says what moved.
 */
describe("extending a deadline tells subscribers what moved", () => {
  it("names each deadline that changed with its old and new time", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);

    const commentsCloseAt = new Date(Date.now() + 3_600_000).toISOString();
    const signingClosesAt = new Date(Date.now() + 7_200_000).toISOString();
    await seedDocument(server, {
      slug: "doc-extended",
      comments_close_at: commentsCloseAt,
      signing_closes_at: signingClosesAt,
    });
    await seedParticipant(server, {
      document: "doc-extended",
      person: "alice",
      token: "alicetoken1234567890",
      first_opened_at: new Date(Date.now() - 60_000).toISOString(),
      notify: { phase_changes: true },
    });

    const laterComments = new Date(Date.now() + 5_400_000).toISOString();
    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-extended/schedule",
      headers: adminHeaders(),
      payload: { comments_close_at: laterComments },
    });
    expect(response.statusCode).toBe(200);

    const fakeMailer = mailer as import("../lib/mailer/index.ts").FakeMailer;
    const message = fakeMailer.sent.find((m) => m.subject.includes("schedule updated"));
    expect(message).toBeDefined();
    expect(message?.text).toMatch(/Comments close moved from .+ to .+\./u);
    // The signing deadline did not move, so it gets no line of its own.
    expect(message?.text).not.toContain("Signatures are due moved");

    await server.close();
  });
});
