import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { FakeMailer } from "../lib/mailer/index.ts";
import { buildTestServer, TEST_ACTOR } from "../routes/test-support.ts";
import { MAGIC_LINK_TTL_SECONDS, signMagicCode, verifyMagicCode } from "./magic-link.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const SECRET = "magic-link-test-secret-32-bytes-minimum!";
const SUBJECT = {
  site: "default",
  operatorId: "team",
  operatorEmail: "team@example.org",
  returnPath: "/admin",
};

function linkIn(text: string): string {
  const match = /https?:\/\/[^/\s]+(\/auth\/callback\?[^\s]+)/u.exec(text);
  if (!match?.[1]) throw new Error(`no magic link in: ${text}`);
  return match[1];
}

describe("magic-link codes", () => {
  it("are 24 base62 characters that verify for exactly what they signed", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const { code, expiresAt } = signMagicCode(SECRET, SUBJECT, now);
    expect(code).toMatch(/^[0-9A-Za-z]{24}$/u);
    expect(expiresAt.getTime() - now.getTime()).toBe(MAGIC_LINK_TTL_SECONDS * 1000);
    expect(verifyMagicCode(SECRET, code, SUBJECT, now)).toEqual(expiresAt);

    for (const changed of [
      { ...SUBJECT, site: "other-site" },
      { ...SUBJECT, operatorId: "someone" },
      { ...SUBJECT, operatorEmail: "new@example.org" },
      { ...SUBJECT, returnPath: "/admin/d/elsewhere" },
    ]) {
      expect(verifyMagicCode(SECRET, code, changed, now)).toBeNull();
    }
    expect(verifyMagicCode("another-secret-entirely-32-bytes-long!!", code, SUBJECT, now)).toBe(
      null,
    );
    // A changed expiry breaks the MAC; a real one past its time is refused.
    expect(verifyMagicCode(SECRET, `zzzzzz${code.slice(6)}`, SUBJECT, now)).toBeNull();
    expect(verifyMagicCode(SECRET, code, SUBJECT, new Date(expiresAt.getTime() + 1))).toBeNull();
    expect(verifyMagicCode(SECRET, "short", SUBJECT, now)).toBeNull();
  });
});

describe("a magic link across a restart", () => {
  it("still signs the operator in on a new instance over the same data repo", async () => {
    const mailer = new FakeMailer();
    const first = await buildTestServer({ mailer });
    cleanups.push(first.cleanup);
    await first.server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: TEST_ACTOR.email, return: "/admin/d/x" },
    });
    const link = linkIn(mailer.sent[0]!.text);
    // The service scales to zero: the instance that sent the link is gone.
    await first.server.close();

    const second = Fastify();
    await second.register(app, {
      storage: { dataDir: first.dataDir, trackerIntervalMs: 3_600_000 },
      notifications: { mailer: new FakeMailer() },
    });
    await second.ready();
    const callback = await second.inject({ method: "GET", url: link });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/admin/d/x");
    expect(String(callback.headers["set-cookie"])).toContain("=");
    await second.close();
  });

  it("refuses a link whose return path was altered, and one for an unknown operator", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: TEST_ACTOR.email },
    });
    const link = linkIn(mailer.sent[0]!.text);

    const tampered = await server.inject({ method: "GET", url: `${link}&return=%2Fadmin%2Fevil` });
    expect(tampered.statusCode).toBe(400);
    const offsite = await server.inject({ method: "GET", url: `${link}&return=%2F%2Fevil.test` });
    expect(offsite.statusCode).toBe(400);
    const unknown = await server.inject({
      method: "GET",
      url: link.replace(/op=[^&]+/u, "op=nobody"),
    });
    expect(unknown.statusCode).toBe(400);

    // The untouched link still works: failures consumed nothing.
    expect((await server.inject({ method: "GET", url: link })).statusCode).toBe(302);
    await server.close();
  });
});
