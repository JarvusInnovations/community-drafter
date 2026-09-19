import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, fakeGoogleAuth } from "../routes/test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  delete process.env.DEV_ADMIN_EMAIL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.COOKIE_SECRET;
  delete process.env.OAUTH_ALLOWED_EMAILS;
  delete process.env.OAUTH_ALLOWED_DOMAINS;
});

function setCookieHeader(response: { headers: { "set-cookie"?: string | string[] } }): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new Error("no Set-Cookie header on response");
  return value.split(";")[0] as string;
}

function stateFromLoginRedirect(location: string): string {
  const url = new URL(location);
  const state = url.searchParams.get("state");
  if (!state) throw new Error("no state param on login redirect");
  return state;
}

describe("GET /auth/login", () => {
  it("503s a clear page when Google/cookie secret aren't configured", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({ method: "GET", url: "/auth/login" });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain("isn't configured");

    await server.close();
  });

  it("dev bypass mints a session directly, skipping Google", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "dev@example.org", COOKIE_SECRET: "a".repeat(32) },
    });
    cleanups.push(cleanup);

    const response = await server.inject({ method: "GET", url: "/auth/login" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/admin");
    const cookie = setCookieHeader(response);

    const session = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().email).toBe("dev@example.org");

    await server.close();
  });
});

describe("GET /auth/callback", () => {
  it("refuses an email outside the allowlist", async () => {
    const { server, cleanup } = await buildTestServer({
      env: {
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        COOKIE_SECRET: "b".repeat(32),
        OAUTH_ALLOWED_EMAILS: "team@example.org",
      },
      auth: { googleAuth: fakeGoogleAuth({ email: "outsider@evil.example", name: "Outsider" }) },
    });
    cleanups.push(cleanup);

    const login = await server.inject({ method: "GET", url: "/auth/login" });
    expect(login.statusCode).toBe(302);
    const state = stateFromLoginRedirect(login.headers.location as string);

    const callback = await server.inject({
      method: "GET",
      url: `/auth/callback?code=fake-code&state=${encodeURIComponent(state)}`,
    });
    expect(callback.statusCode).toBe(403);
    expect(callback.body).toContain("not on the admin allowlist");
    expect(callback.headers["set-cookie"]).toBeUndefined();

    await server.close();
  });

  it("mints a 24h session for an allowed email", async () => {
    const { server, cleanup } = await buildTestServer({
      env: {
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        COOKIE_SECRET: "c".repeat(32),
        OAUTH_ALLOWED_EMAILS: "team@example.org",
      },
      auth: { googleAuth: fakeGoogleAuth({ email: "team@example.org", name: "Team" }) },
    });
    cleanups.push(cleanup);

    const login = await server.inject({
      method: "GET",
      url: "/auth/login?return=%2Fadmin%2Fd%2Fx",
    });
    const state = stateFromLoginRedirect(login.headers.location as string);

    const callback = await server.inject({
      method: "GET",
      url: `/auth/callback?code=fake-code&state=${encodeURIComponent(state)}`,
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
    expect(body.email).toBe("team@example.org");
    const expiresAt = new Date(body.expires_at).getTime();
    const expectedTtlMs = 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - (Date.now() + expectedTtlMs))).toBeLessThan(5_000);

    await server.close();
  });

  it("an allowed domain (@example.org wildcard) also passes", async () => {
    const { server, cleanup } = await buildTestServer({
      env: {
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        COOKIE_SECRET: "d".repeat(32),
        OAUTH_ALLOWED_DOMAINS: "example.org",
      },
      auth: { googleAuth: fakeGoogleAuth({ email: "anyone@example.org" }) },
    });
    cleanups.push(cleanup);

    const login = await server.inject({ method: "GET", url: "/auth/login" });
    const state = stateFromLoginRedirect(login.headers.location as string);
    const callback = await server.inject({
      method: "GET",
      url: `/auth/callback?code=fake-code&state=${encodeURIComponent(state)}`,
    });
    expect(callback.statusCode).toBe(302);

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
      env: { DEV_ADMIN_EMAIL: "dev@example.org", COOKIE_SECRET: "e".repeat(32) },
    });
    cleanups.push(cleanup);
    const cookie = await signedInCookie(server);

    await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: { cookie },
      payload: {
        slug: "doc-csrf",
        title: "Doc CSRF",
        owner: "team",
        sender_name: "Team",
        reply_to: "team@example.org",
      },
    });

    const withoutHeader = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: { cookie },
      payload: {
        slug: "doc-csrf-2",
        title: "Doc CSRF 2",
        owner: "team",
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
        owner: "team",
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
      headers: { authorization: "Bearer s3cr3t-admin-token" },
      payload: {
        slug: "doc-bearer",
        title: "Doc Bearer",
        owner: "team",
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
   * consulting) the cookie. Proven here by presenting a *valid* cookie
   * alongside an *invalid* bearer token: if the cookie were consulted at
   * all, this would 200 (the CSRF header is also present); it must 401
   * instead, exactly as a bearer-only request with a bad token would.
   */
  it("a request presenting both a session cookie and a bearer header resolves via bearer only", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "dev@example.org", COOKIE_SECRET: "g".repeat(32) },
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
        owner: "team",
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
  it("revokes the session so the old cookie no longer authenticates", async () => {
    const { server, cleanup } = await buildTestServer({
      env: { DEV_ADMIN_EMAIL: "dev@example.org", COOKIE_SECRET: "f".repeat(32) },
    });
    cleanups.push(cleanup);

    const login = await server.inject({ method: "GET", url: "/auth/login" });
    const cookie = setCookieHeader(login);

    await server.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });

    const session = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(401);

    await server.close();
  });
});
