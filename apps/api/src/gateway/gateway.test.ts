import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { createTestDataRepo } from "../storage/test-helpers.ts";
import {
  ADMIN_ROUTE,
  participantWriteLimiter,
  PARTICIPANT_ROUTE,
  tokenFailureLimiter,
} from "./gateway.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

beforeEach(() => {
  tokenFailureLimiter.reset();
  participantWriteLimiter.reset();
});

async function buildServer() {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_TOKEN = "s3cr3t-admin-token";
  const { dataDir, cleanup } = await createTestDataRepo();
  cleanups.push(cleanup);

  const server = Fastify();
  await server.register(app, {
    storage: { dataDir, trackerIntervalMs: 3_600_000 },
    disablePhaseObserver: true,
  });

  // Test-only routes exercising each capability, added after `app` so the
  // gateway hook (registered inside `app` via a chain of `fp`-wrapped
  // plugins) already covers the whole instance.
  server.get("/__test/admin-only", { config: ADMIN_ROUTE }, async () => ({ ok: true }));
  server.get("/__test/undeclared", async () => ({ ok: true }));
  server.get(
    "/i/:token/__test/participant-only",
    { config: PARTICIPANT_ROUTE },
    async (request) => ({ principal: request.principal }),
  );
  server.post("/i/:token/__test/participant-write", { config: PARTICIPANT_ROUTE }, async () => ({
    ok: true,
  }));

  await server.ready();
  return { server };
}

describe("gateway: deny by default", () => {
  it("403s a route with no declared capability", async () => {
    const { server } = await buildServer();
    const response = await server.inject({ method: "GET", url: "/__test/undeclared" });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("forbidden");
    await server.close();
  });
});

describe("gateway: admin bearer", () => {
  it("401s a missing or wrong bearer token", async () => {
    const { server } = await buildServer();

    const missing = await server.inject({ method: "GET", url: "/__test/admin-only" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error).toBe("unauthenticated");

    const wrong = await server.inject({
      method: "GET",
      url: "/__test/admin-only",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.statusCode).toBe(401);

    await server.close();
  });

  it("200s the correct bearer token", async () => {
    const { server } = await buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/__test/admin-only",
      headers: { authorization: "Bearer s3cr3t-admin-token" },
    });
    expect(response.statusCode).toBe(200);
    await server.close();
  });
});

describe("gateway: participant token resolution", () => {
  it("produces byte-identical 404 bodies for unknown, revoked and expired tokens", async () => {
    const { server } = await buildServer();
    const actor = { kind: "admin" as const, email: "team@example.org" };

    await server.storage.commit(
      "invite",
      { actor, subject: "invite: revoked-person, expired-person on doc-a", document: "doc-a" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-a",
          title: "Doc A",
          state: "open",
          body: "text",
          comments_close_at: "2099-01-01T00:00:00Z",
          signing_closes_at: "2099-02-01T00:00:00Z",
        });
        await tx.people.upsert({
          id: "revoked-person",
          name: "Revoked Person",
          email: "revoked@example.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-a",
          person: "revoked-person",
          token: "revoked00000000tok1",
          source: "admin",
          link_revoked: true,
        });
        await tx.people.upsert({
          id: "expired-person",
          name: "Expired Person",
          email: "expired@example.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-a",
          person: "expired-person",
          token: "expired000000000tok2",
          source: "admin",
          expires_at: "2000-01-01T00:00:00Z",
        });
      },
    );

    const unknown = await server.inject({
      method: "GET",
      url: "/i/does-not-exist-at-all/__test/participant-only",
    });
    const revoked = await server.inject({
      method: "GET",
      url: "/i/revoked00000000tok1/__test/participant-only",
    });
    const expired = await server.inject({
      method: "GET",
      url: "/i/expired000000000tok2/__test/participant-only",
    });

    for (const response of [unknown, revoked, expired]) {
      expect(response.statusCode).toBe(404);
    }
    expect(unknown.body).toBe(revoked.body);
    expect(revoked.body).toBe(expired.body);
    expect(JSON.parse(unknown.body)).toEqual({
      error: "not_found",
      message:
        "This link isn't available. If you believe this is a mistake, please contact the team that sent it to you.",
      details: {},
    });

    await server.close();
  });

  it("resolves a valid token to a participant principal", async () => {
    const { server } = await buildServer();
    const actor = { kind: "admin" as const, email: "team@example.org" };

    await server.storage.commit(
      "invite",
      { actor, subject: "invite: jane-doe on doc-b", document: "doc-b" },
      async (tx) => {
        await tx.documents.upsert({ slug: "doc-b", title: "Doc B", state: "open", body: "text" });
        await tx.people.upsert({
          id: "jane-doe",
          name: "Jane Doe",
          email: "jane@example.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-b",
          person: "jane-doe",
          token: "validtoken0000000001",
          source: "admin",
        });
      },
    );

    const response = await server.inject({
      method: "GET",
      url: "/i/validtoken0000000001/__test/participant-only",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().principal).toEqual({
      kind: "participant",
      token: "validtoken0000000001",
      document: "doc-b",
      person: "jane-doe",
    });

    await server.close();
  });

  it("rate-limits participant writes at 60/min per token", async () => {
    const { server } = await buildServer();
    const actor = { kind: "admin" as const, email: "team@example.org" };

    await server.storage.commit(
      "invite",
      { actor, subject: "invite: jane-doe on doc-c", document: "doc-c" },
      async (tx) => {
        await tx.documents.upsert({ slug: "doc-c", title: "Doc C", state: "open", body: "text" });
        await tx.people.upsert({
          id: "jane-doe",
          name: "Jane Doe",
          email: "jane@example.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-c",
          person: "jane-doe",
          token: "writelimittoken00001",
          source: "admin",
        });
      },
    );

    let lastStatus = 0;
    for (let i = 0; i < 61; i++) {
      const response = await server.inject({
        method: "POST",
        url: "/i/writelimittoken00001/__test/participant-write",
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);

    await server.close();
  });
});
