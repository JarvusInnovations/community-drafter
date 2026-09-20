import { afterEach, describe, expect, it } from "bun:test";

import {
  buildTestServer,
  TEST_ACTOR,
  TEST_ADMIN_TOKEN,
  TEST_AUTH_SECRET,
  adminHeaders,
} from "../routes/test-support.ts";
import { FixedWindowLimiter } from "../gateway/rate-limit.ts";
import { FakeMailer } from "../lib/mailer/index.ts";
import { mintOperatorToken, verifyOperatorToken } from "./tokens.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  delete process.env.DEV_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
});

function setCookieHeader(response: { headers: { "set-cookie"?: string | string[] } }): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new Error("no Set-Cookie header on response");
  return value.split(";")[0] as string;
}

/** The emailed link carries a 24-char code, never the token (`specs/api/auth.md`). */
function extractMagicCode(text: string): string {
  const match = /callback\?code=([A-Za-z0-9]{24})(?![A-Za-z0-9])/u.exec(text);
  if (!match?.[1]) throw new Error(`no magic code found in: ${text}`);
  return match[1];
}

describe("POST /auth/login", () => {
  it("always 202s, whether or not the address is an operator", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);

    const nonOperator = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.org" },
    });
    expect(nonOperator.statusCode).toBe(202);
    expect(nonOperator.json<{ ok: boolean }>()).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(0);

    const known = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: TEST_ACTOR.email },
    });
    expect(known.statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain("Sign in to");
    expect(mailer.sent[0]?.to.email).toBe(TEST_ACTOR.email);

    await server.close();
  });

  it("does not email an inactive operator", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);

    // Self-deactivation is refused (422), so create and deactivate a
    // *different* operator instead of `TEST_ACTOR`.
    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "inactive-op@example.org", name: "Inactive Op" },
    });
    const deactivate = await server.inject({
      method: "PATCH",
      url: "/admin/api/operators/inactive-op@example.org",
      headers: adminHeaders(),
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);

    const login = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "inactive-op@example.org" },
    });
    expect(login.statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(0);

    await server.close();
  });

  it("rate-limits at 5 per address and 5 per source IP per 15 minutes", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    let last = 0;
    for (let i = 0; i < 6; i++) {
      const response = await server.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: `rate-limit-${i}@example.org` },
      });
      last = response.statusCode;
    }
    expect(last).toBe(429);

    await server.close();
  });
});

describe("GET /auth/callback", () => {
  it("verifies the magic token, sets a session cookie, and redirects to the return path", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: TEST_ACTOR.email, return: "/admin/d/x" },
    });
    const token = extractMagicCode(mailer.sent[0]!.text);

    const callback = await server.inject({
      method: "GET",
      url: `/auth/callback?code=${token}`,
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/admin/d/x");
    const cookie = setCookieHeader(callback);

    const session = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    const body = session.json();
    expect(body.email).toBe(TEST_ACTOR.email);
    expect(body.transport).toBe("cookie");
    const expiresAt = new Date(body.expires_at).getTime();
    expect(Math.abs(expiresAt - (Date.now() + 24 * 60 * 60 * 1000))).toBeLessThan(5_000);

    await server.close();
  });

  /** `specs/api/auth.md` § `GET /auth/session`: the frame's instance name rides on the session (#37). */
  it("returns the configured INSTANCE_NAME as instance_name", async () => {
    const { server, cleanup } = await buildTestServer({ env: { INSTANCE_NAME: "Test Instance" } });
    cleanups.push(cleanup);

    const session = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: adminHeaders(),
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().instance_name).toBe("Test Instance");

    await server.close();
  });

  it("falls back to Community Drafter when INSTANCE_NAME is unset", async () => {
    const { server, cleanup } = await buildTestServer({ env: { INSTANCE_NAME: undefined } });
    cleanups.push(cleanup);

    const session = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: adminHeaders(),
    });
    expect(session.json().instance_name).toBe("Community Drafter");

    await server.close();
  });

  it("a used token cannot be replayed", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: TEST_ACTOR.email },
    });
    const token = extractMagicCode(mailer.sent[0]!.text);

    const first = await server.inject({ method: "GET", url: `/auth/callback?code=${token}` });
    expect(first.statusCode).toBe(302);

    const second = await server.inject({ method: "GET", url: `/auth/callback?code=${token}` });
    expect(second.statusCode).toBe(400);
    expect(second.body).toContain("isn't valid any more");

    await server.close();
  });

  it("an unknown/garbage token fails with the friendly page", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({ method: "GET", url: "/auth/callback?code=garbage" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("isn't valid any more");

    await server.close();
  });
});

describe("operator_inactive", () => {
  it("401s a bearer token for a deactivated operator", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "soon-inactive@example.org", name: "Soon Inactive" },
    });
    const minted = await mintOperatorToken({
      purpose: "cli",
      email: "soon-inactive@example.org",
      name: "Soon Inactive",
      kind: "person",
      secret: TEST_AUTH_SECRET,
    });

    const stillActive = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { authorization: `Bearer ${minted.token}` },
    });
    expect(stillActive.statusCode).toBe(200);

    const deactivate = await server.inject({
      method: "PATCH",
      url: "/admin/api/operators/soon-inactive@example.org",
      headers: adminHeaders(),
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { authorization: `Bearer ${minted.token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("operator_inactive");

    await server.close();
  });

  it("401s an existing session cookie for a deactivated operator too", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "cookie-inactive@example.org" },
    });
    cleanups.push(cleanup);

    const login = await server.inject({ method: "GET", url: "/auth/login" });
    const cookie = setCookieHeader(login);

    const stillActive = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { cookie },
    });
    expect(stillActive.statusCode).toBe(200);

    const deactivate = await server.inject({
      method: "PATCH",
      url: "/admin/api/operators/cookie-inactive@example.org",
      headers: adminHeaders(),
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("operator_inactive");

    await server.close();
  });
});

describe("cookie-authenticated writes require the CSRF header", () => {
  async function signedInCookie(server: import("fastify").FastifyInstance): Promise<string> {
    const login = await server.inject({ method: "GET", url: "/auth/login" });
    return setCookieHeader(login);
  }

  it("403s a cookie POST without X-Requested-With, 200s with it", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "dev@example.org" },
    });
    cleanups.push(cleanup);
    const cookie = await signedInCookie(server);

    const withoutHeader = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: { cookie },
      payload: {
        slug: "doc-csrf-2",
        title: "Doc CSRF 2",
        sender_name: "Team",
        reply_to: "team@example.org",
      },
    });
    expect(withoutHeader.statusCode).toBe(403);
    expect(withoutHeader.json().error).toBe("csrf_required");

    const withHeader = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: { cookie, "x-requested-with": "drafter" },
      payload: {
        slug: "doc-csrf-3",
        title: "Doc CSRF 3",
        sender_name: "Team",
        reply_to: "team@example.org",
      },
    });
    expect(withHeader.statusCode).toBe(201);

    // Cookie-authenticated reads never need the header.
    const read = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);

    await server.close();
  });

  it("bearer writes are unaffected by the CSRF header requirement", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-bearer",
        title: "Doc Bearer",
        sender_name: "Team",
        reply_to: "team@example.org",
      },
    });
    expect(response.statusCode).toBe(201);

    await server.close();
  });

  /**
   * `specs/api/conventions.md`: "a present `Authorization` header is
   * decisive" — a request presenting both a bearer token and a session
   * cookie resolves via bearer only, never falling back to (or even
   * consulting) the cookie.
   */
  it("a request presenting both a session cookie and a bearer header resolves via bearer only", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "dev@example.org" },
    });
    cleanups.push(cleanup);
    const cookie = await signedInCookie(server);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: { cookie, "x-requested-with": "drafter", authorization: "Bearer wrong-token" },
      payload: {
        slug: "doc-both-transports",
        title: "Doc Both Transports",
        sender_name: "Team",
        reply_to: "team@example.org",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("unauthenticated");

    await server.close();
  });
});

describe("POST /auth/logout", () => {
  it("clears the session cookie", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "dev@example.org" },
    });
    cleanups.push(cleanup);

    const login = await server.inject({ method: "GET", url: "/auth/login" });
    const cookie = setCookieHeader(login);

    const logout = await server.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie, "x-requested-with": "drafter" },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");

    await server.close();
  });
});

describe("POST /auth/refresh", () => {
  it("mints a new 90-day CLI token for the bearer-presented operator", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.email).toBe(TEST_ACTOR.email);
    expect(body.token).not.toBe(TEST_ADMIN_TOKEN);

    await server.close();
  });

  it("refuses a cookie-only request (bearer only)", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "dev@example.org" },
    });
    cleanups.push(cleanup);
    const login = await server.inject({ method: "GET", url: "/auth/login" });
    const cookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookie) ? cookie[0]!.split(";")[0] : cookie?.split(";")[0];

    const response = await server.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: cookieHeader!, "x-requested-with": "drafter" },
    });
    expect(response.statusCode).toBe(401);

    await server.close();
  });
});

describe("device-code flow", () => {
  it("202s a device/user code pair, and 409s device/token until approved", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({
      mailer,
      env: { DEV_ADMIN_EMAIL: TEST_ACTOR.email },
    });
    cleanups.push(cleanup);

    const device = await server.inject({
      method: "POST",
      url: "/auth/device",
      payload: { email: TEST_ACTOR.email },
    });
    expect(device.statusCode).toBe(202);
    const { device_code, user_code, expires_in, interval } = device.json();
    expect(user_code).toHaveLength(8);
    expect(expires_in).toBe(900);
    expect(interval).toBe(3);
    // The device return path travels inside the signed magic token's
    // `return` claim, not in the visible email text.
    const magicCode = extractMagicCode(mailer.sent[0]!.text);
    const magicToken = server.auth.magicCodes.peek(magicCode);
    expect(magicToken).not.toBeNull();
    const verified = await verifyOperatorToken(magicToken!, TEST_AUTH_SECRET, "magic");
    expect(verified?.returnPath).toBe(`/auth/device?code=${user_code}`);
    // The device email names the user code and never the token itself.
    expect(mailer.sent[0]!.text).toContain(user_code);
    expect(mailer.sent[0]!.text).not.toContain("eyJ");
    expect(mailer.sent[0]!.html).not.toContain("eyJ");

    const pending = await server.inject({
      method: "POST",
      url: "/auth/device/token",
      payload: { device_code },
    });
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error).toBe("device_pending");

    // Sign in (dev shortcut) and approve.
    const login = await server.inject({ method: "GET", url: "/auth/login" });
    const cookie = setCookieHeader(login);

    const approve = await server.inject({
      method: "POST",
      url: "/auth/device/approve",
      headers: { cookie, "x-requested-with": "drafter" },
      payload: { user_code },
    });
    expect(approve.statusCode).toBe(200);

    const approved = await server.inject({
      method: "POST",
      url: "/auth/device/token",
      payload: { device_code },
    });
    expect(approved.statusCode).toBe(200);
    const body = approved.json();
    expect(body.email).toBe(TEST_ACTOR.email);
    expect(typeof body.token).toBe("string");

    await server.close();
  });

  it("404s an unknown device code", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({
      method: "POST",
      url: "/auth/device/token",
      payload: { device_code: "does-not-exist" },
    });
    expect(response.statusCode).toBe(404);

    await server.close();
  });
});

describe("GET /auth/login (dev shortcut)", () => {
  it("404s when DEV_ADMIN_EMAIL is unset", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({ method: "GET", url: "/auth/login" });
    expect(response.statusCode).toBe(404);

    await server.close();
  });

  it("mints a session for a brand-new email, creating the operator on the fly", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "fresh-dev@example.org" },
    });
    cleanups.push(cleanup);

    const login = await server.inject({ method: "GET", url: "/auth/login" });
    expect(login.statusCode).toBe(302);
    const cookie = setCookieHeader(login);

    const session = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });
    expect(session.json().email).toBe("fresh-dev@example.org");

    await server.close();
  });
});

describe("rate limiter unit", () => {
  it("resets independently per instance", () => {
    const limiter = new FixedWindowLimiter(2, 1000);
    expect(limiter.hit("a")).toBe(true);
    expect(limiter.hit("a")).toBe(true);
    expect(limiter.hit("a")).toBe(false);
    limiter.reset();
    expect(limiter.hit("a")).toBe(true);
  });
});

describe("operator-magic-link email", () => {
  it("greets by name, says it was requested on the web, carries a short-code link and no token", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: TEST_ACTOR.email, return: "/admin" },
    });
    const sent = mailer.sent[0]!;
    expect(sent.subject).toBe("Sign in to Community Drafter");
    expect(sent.text).toContain("on the web");
    expect(sent.text).toMatch(/\/auth\/callback\?code=[A-Za-z0-9]{24}\b/u);
    expect(sent.text).not.toContain("eyJ");
    expect(sent.html).toContain("Sign in to Community Drafter");
    expect(sent.text).toContain("If you didn't request this");
    await server.close();
  });
});
