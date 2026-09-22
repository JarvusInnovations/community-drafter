import { afterEach, describe, expect, it } from "bun:test";

import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedParticipant,
} from "../routes/test-support.ts";
import type { FakeMailer } from "../lib/mailer/index.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const HOUR = 3_600_000;
const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

/**
 * Build an open document already in its signing phase, with one participant
 * who has opened their link and not signed — the clock audience of
 * `specs/behaviors/notifications.md` § Sending.
 */
async function signingDocument(opts: {
  slug: string;
  windowStartMs: number;
  windowEndMs: number;
  /** When `signing-opened` was recorded as sent; omit for a document that never sent it. */
  signingOpenedMs?: number;
}) {
  const built = await buildTestServer();
  cleanups.push(built.cleanup);
  await seedDocument(built.server, {
    slug: opts.slug,
    comments_close_at: at(opts.windowStartMs),
    signing_closes_at: at(opts.windowEndMs),
  });
  await seedParticipant(built.server, {
    document: opts.slug,
    person: "reader",
    token: `${opts.slug.replaceAll("-", "")}token1234567890`.slice(0, 24),
    first_opened_at: at(-60_000),
    ...(opts.signingOpenedMs === undefined
      ? {}
      : { notified: { "signing-opened": at(opts.signingOpenedMs) } }),
  });
  return built;
}

function closingSoonCount(mailer: FakeMailer): number {
  return mailer.sent.filter((m) => m.subject.includes("closes soon")).length;
}

describe("closing-soon scheduling", () => {
  it("sends nothing for a two-hour window: the midpoint falls inside the quiet period", async () => {
    // The live case — a window so short that its midpoint is well within
    // the six hours after `signing-opened`, and the window is over before
    // the quiet period ends.
    const { server, mailer } = await signingDocument({
      slug: "doc-two-hour",
      windowStartMs: -0.5 * HOUR,
      windowEndMs: 1.5 * HOUR,
      signingOpenedMs: -0.5 * HOUR,
    });
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(0);
    await server.close();
  });

  it("waits for the midpoint on a window shorter than the 24-hour lead", async () => {
    // A 21-hour window: the 24-hour lead is long past and the quiet period
    // ended two hours ago, so only the midpoint (2.5 hours out) holds this.
    const { server, mailer } = await signingDocument({
      slug: "doc-short-early",
      windowStartMs: -8 * HOUR,
      windowEndMs: 13 * HOUR,
      signingOpenedMs: -8 * HOUR,
    });
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(0);
    await server.close();
  });

  it("sends at the midpoint once a short window reaches it", async () => {
    // The same 21-hour window, observed after its midpoint.
    const { server, mailer } = await signingDocument({
      slug: "doc-short-mid",
      windowStartMs: -16 * HOUR,
      windowEndMs: 5 * HOUR,
      signingOpenedMs: -16 * HOUR,
    });
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(1);
    expect((mailer as FakeMailer).sent[0]?.to.email).toBe("reader@example.org");
    await server.close();
  });

  it("holds the quiet period even when the 24-hour mark has passed", async () => {
    // A 28-hour window: the 24-hour mark arrived four hours into it, two
    // hours before the quiet period ends.
    const { server, mailer } = await signingDocument({
      slug: "doc-quiet-hold",
      windowStartMs: -4 * HOUR,
      windowEndMs: 24 * HOUR,
      signingOpenedMs: -4 * HOUR,
    });
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(0);
    await server.close();
  });

  it("sends at the 24-hour mark on a long window, and not before it", async () => {
    const { server, mailer } = await signingDocument({
      slug: "doc-long",
      windowStartMs: -72 * HOUR,
      windowEndMs: 25 * HOUR,
      signingOpenedMs: -72 * HOUR,
    });
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(0);

    await server.storage.commit(
      "settings",
      {
        actor: { kind: "system" },
        subject: "settings: doc-long (inside the 24-hour lead)",
        document: "doc-long",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "doc-long" }, { signing_closes_at: at(23 * HOUR) });
      },
    );
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(1);
    await server.close();
  });

  it("applies no quiet period when signing-opened reached nobody", async () => {
    const { server, mailer } = await signingDocument({
      slug: "doc-no-anchor",
      windowStartMs: -0.5 * HOUR,
      windowEndMs: 1.5 * HOUR,
    });
    // Midpoint half an hour out, nothing to be quiet after — so still not
    // yet due; move past the midpoint and it goes.
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(0);

    await server.storage.commit(
      "settings",
      {
        actor: { kind: "system" },
        subject: "settings: doc-no-anchor (past the midpoint)",
        document: "doc-no-anchor",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "doc-no-anchor" }, { comments_close_at: at(-1.5 * HOUR) });
      },
    );
    await server.closingSoonScheduler.tick();
    expect(closingSoonCount(mailer as FakeMailer)).toBe(1);
    await server.close();
  });
});

describe("the clock audience", () => {
  it("schedule-changed skips the never-opened and the current signer, and returns to a signer who removes their name", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    const fakeMailer = mailer as FakeMailer;

    await seedDocument(server, {
      slug: "doc-audience",
      comments_close_at: at(HOUR),
      signing_closes_at: at(48 * HOUR),
    });
    await seedParticipant(server, {
      document: "doc-audience",
      person: "opened",
      token: "openedtoken1234567890",
      first_opened_at: at(-HOUR),
    });
    await seedParticipant(server, {
      document: "doc-audience",
      person: "unopened",
      token: "unopenedtoken12345678",
    });
    await seedParticipant(server, {
      document: "doc-audience",
      person: "signer",
      token: "signertoken1234567890",
      first_opened_at: at(-HOUR),
    });
    await seedParticipant(server, {
      document: "doc-audience",
      person: "muted",
      token: "mutedtoken12345678901",
      first_opened_at: at(-HOUR),
      notify: { phase_changes: false },
    });

    await server.inject({
      method: "POST",
      url: "/i/signertoken1234567890/api/signature",
      payload: { capacity: "personal", display_name: "Sam Signer" },
    });

    const extend = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-audience/schedule",
      headers: adminHeaders(),
      payload: { signing_closes_at: at(72 * HOUR) },
    });
    expect(extend.statusCode).toBe(200);

    const told = (): string[] =>
      fakeMailer.sent
        .filter((m) => m.subject.includes("schedule updated"))
        .map((m) => m.to.email ?? "");
    expect(told()).toEqual(["opened@example.org"]);

    // Removing the name makes them an opened non-signer again, so the next
    // schedule change reaches them.
    await server.inject({
      method: "DELETE",
      url: "/i/signertoken1234567890/api/signature",
      payload: { reason: "changed my mind" },
    });
    const extendAgain = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-audience/schedule",
      headers: adminHeaders(),
      payload: { signing_closes_at: at(96 * HOUR) },
    });
    expect(extendAgain.statusCode).toBe(200);
    expect(told()).toContain("signer@example.org");
    expect(told()).not.toContain("unopened@example.org");
    expect(told()).not.toContain("muted@example.org");

    await server.close();
  });
});
