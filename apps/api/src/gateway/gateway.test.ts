import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { mintOperatorToken } from "../auth/tokens.ts";
import {
  adminHeaders,
  seedDocument,
  TEST_ACTOR,
  TEST_AUTH_SECRET,
} from "../routes/test-support.ts";
import { createTestDataRepo } from "../storage/test-helpers.ts";
import {
  DOCUMENT_SCOPED_ROUTE,
  OPERATOR_ROUTE,
  participantWriteLimiter,
  PARTICIPANT_ROUTE,
  tokenFailureLimiter,
  WEBHOOK_ROUTE,
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
  process.env.AUTH_SECRET = TEST_AUTH_SECRET;
  process.env.BOOTSTRAP_OPERATOR_EMAIL = TEST_ACTOR.email;
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
  server.get("/__test/operator-only", { config: OPERATOR_ROUTE }, async (request) => ({
    principal: request.principal,
  }));
  server.get<{ Params: { slug: string } }>(
    "/__test/scoped/:slug",
    { config: DOCUMENT_SCOPED_ROUTE },
    async () => ({ ok: true }),
  );
  // Raw-body capture for the webhook test below, scoped to this throwaway
  // instance only — mirrors `routes/admin/instance.ts`'s own parser.
  server.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      try {
        done(null, body.length ? JSON.parse(body.toString("utf8")) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  server.post("/__test/webhook", { config: WEBHOOK_ROUTE }, async () => ({ ok: true }));
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

describe("gateway: operator bearer", () => {
  it("401s a missing or wrong bearer token", async () => {
    const { server } = await buildServer();

    const missing = await server.inject({ method: "GET", url: "/__test/operator-only" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error).toBe("unauthenticated");

    const wrong = await server.inject({
      method: "GET",
      url: "/__test/operator-only",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.statusCode).toBe(401);

    await server.close();
  });

  it("200s a valid bearer token for an active operator", async () => {
    const { server } = await buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/__test/operator-only",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().principal).toEqual({
      kind: "operator",
      email: TEST_ACTOR.email,
      // The bootstrap operator's `name` (`operators-bootstrap.ts`) — live
      // state, not the bearer token's own `name` claim (`Team`), per
      // "authorization comes from live state, never token claims."
      name: TEST_ACTOR.email,
      operatorKind: "person",
      // The bootstrap operator is seeded as a superadmin (`behaviors/operators.md`).
      superadmin: true,
      transport: "bearer",
      exp: expect.any(Number),
    });

    await server.close();
  });

  it("401s a well-formed token for an operator that no longer exists", async () => {
    const { server } = await buildServer();
    const minted = await mintOperatorToken({
      purpose: "cli",
      email: "ghost@example.org",
      name: "Ghost",
      kind: "person",
      secret: TEST_AUTH_SECRET,
    });

    const response = await server.inject({
      method: "GET",
      url: "/__test/operator-only",
      headers: { authorization: `Bearer ${minted.token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("unauthenticated");

    await server.close();
  });
});

describe("gateway: document scoping", () => {
  it("404s a document-scoped route for an operator not on the document", async () => {
    const { server } = await buildServer();

    // A plain (non-superadmin) operator; the bootstrap operator would pass.
    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "plain@example.org", name: "Plain Op" },
    });
    const plain = await mintOperatorToken({
      purpose: "cli",
      email: "plain@example.org",
      name: "Plain Op",
      kind: "person",
      secret: TEST_AUTH_SECRET,
    });
    await seedDocument(server, { slug: "scoped-doc", operators: ["someone-else@example.org"] });

    const response = await server.inject({
      method: "GET",
      url: "/__test/scoped/scoped-doc",
      headers: { authorization: `Bearer ${plain.token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");

    await server.close();
  });

  it("200s a document-scoped route for a superadmin who is not on the document", async () => {
    const { server } = await buildServer();
    await seedDocument(server, { slug: "not-mine", operators: ["someone-else@example.org"] });

    const response = await server.inject({
      method: "GET",
      url: "/__test/scoped/not-mine",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);

    await server.close();
  });

  it("200s a document-scoped route for a current operator of the document", async () => {
    const { server } = await buildServer();
    await seedDocument(server, { slug: "my-doc", operators: [TEST_ACTOR.email] });

    const response = await server.inject({
      method: "GET",
      url: "/__test/scoped/my-doc",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);

    await server.close();
  });

  it("404s (not_found, same as unknown) an unknown document, identically to an unscoped one", async () => {
    const { server } = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/__test/scoped/does-not-exist",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");

    await server.close();
  });
});

describe("gateway: webhook capability", () => {
  it("401s a missing or wrong signature, 200s a valid one", async () => {
    // `@fastify/env` reads env vars once at boot, so this must be set
    // before `buildServer()` registers the app, not after.
    process.env.DATA_REPO_WEBHOOK_SECRET = "webhook-secret";
    const { server } = await buildServer();

    const missing = await server.inject({ method: "POST", url: "/__test/webhook", payload: {} });
    expect(missing.statusCode).toBe(401);

    const body = JSON.stringify({ hello: "world" });
    const wrongSig = createHmac("sha256", "wrong-secret").update(body).digest("hex");
    const wrong = await server.inject({
      method: "POST",
      url: "/__test/webhook",
      headers: { "x-hub-signature-256": `sha256=${wrongSig}`, "content-type": "application/json" },
      payload: body,
    });
    expect(wrong.statusCode).toBe(401);

    const correctSig = createHmac("sha256", "webhook-secret").update(body).digest("hex");
    const valid = await server.inject({
      method: "POST",
      url: "/__test/webhook",
      headers: {
        "x-hub-signature-256": `sha256=${correctSig}`,
        "content-type": "application/json",
      },
      payload: body,
    });
    expect(valid.statusCode).toBe(200);

    delete process.env.DATA_REPO_WEBHOOK_SECRET;
    await server.close();
  });
});

describe("gateway: participant token resolution", () => {
  it("produces byte-identical 404 bodies for unknown, revoked and expired tokens", async () => {
    const { server } = await buildServer();
    const actor = TEST_ACTOR;

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
          created_by: actor.email,
          operators: [actor.email],
        });
        await tx.people.upsert({
          site: "default",
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
          site: "default",
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
    const actor = TEST_ACTOR;

    await server.storage.commit(
      "invite",
      { actor, subject: "invite: jane-doe on doc-b", document: "doc-b" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-b",
          title: "Doc B",
          state: "open",
          body: "text",
          created_by: actor.email,
          operators: [actor.email],
        });
        await tx.people.upsert({
          site: "default",
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
    const actor = TEST_ACTOR;

    await server.storage.commit(
      "invite",
      { actor, subject: "invite: jane-doe on doc-c", document: "doc-c" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-c",
          title: "Doc C",
          state: "open",
          body: "text",
          created_by: actor.email,
          operators: [actor.email],
        });
        await tx.people.upsert({
          site: "default",
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
