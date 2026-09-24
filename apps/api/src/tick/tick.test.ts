import { afterEach, describe, expect, it } from "bun:test";
import type { FastifyInstance } from "fastify";
import { generateKeyPair, SignJWT } from "jose";

import type { FakeMailer } from "../lib/mailer/index.ts";
import { buildTestServer, seedDocument, seedParticipant } from "../routes/test-support.ts";

/**
 * `specs/architecture.md` § Deployment, "The scheduler": `POST
 * /internal/tick` takes only a Google-signed OIDC ID token for the tick
 * invoker, and each tick runs every scheduled step once.
 */
const AUDIENCE = "signatories-tick-test";
const INVOKER = "signatories-tick@example-project.iam.gserviceaccount.com";

const google = await generateKeyPair("RS256");
const stranger = await generateKeyPair("RS256");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  for (const key of [
    "TICK_AUDIENCE",
    "TICK_INVOKER_EMAIL",
    "INSTANCE_DIGEST_HOUR",
    "INSTANCE_TIMEZONE",
  ]) {
    delete process.env[key];
  }
});

interface TokenOverrides {
  key?: CryptoKey;
  issuer?: string;
  audience?: string;
  email?: string;
  emailVerified?: boolean;
  expiresIn?: string;
}

async function idToken(overrides: TokenOverrides = {}): Promise<string> {
  return new SignJWT({
    email: overrides.email ?? INVOKER,
    email_verified: overrides.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject("1234567890")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "1h")
    .sign(overrides.key ?? google.privateKey);
}

async function tickServer(env: Record<string, string | undefined> = {}) {
  const built = await buildTestServer({
    tick: { keys: google.publicKey },
    env: { TICK_AUDIENCE: AUDIENCE, TICK_INVOKER_EMAIL: INVOKER, ...env },
  });
  cleanups.push(built.cleanup);
  return built;
}

function postTick(server: FastifyInstance, authorization?: string) {
  return server.inject({
    method: "POST",
    url: "/internal/tick",
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /internal/tick authentication", () => {
  it("refuses a request with no token, a garbage token, or a non-bearer header", async () => {
    const { server } = await tickServer();
    for (const header of [undefined, "Bearer garbage", `Basic ${btoa("a:b")}`]) {
      const response = await postTick(server, header);
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe("unauthenticated");
    }
    await server.close();
  });

  it("refuses a token signed by another key, or for the wrong audience, issuer or invoker", async () => {
    const { server } = await tickServer();
    const bad = [
      await idToken({ key: stranger.privateKey }),
      await idToken({ audience: "someone-else" }),
      await idToken({ issuer: "https://evil.example" }),
      await idToken({ email: "other@example-project.iam.gserviceaccount.com" }),
      await idToken({ emailVerified: false }),
      await idToken({ expiresIn: "-1m" }),
    ];
    for (const token of bad) {
      expect((await postTick(server, `Bearer ${token}`)).statusCode).toBe(401);
    }
    await server.close();
  });

  it("refuses every tick when the audience or invoker is not configured", async () => {
    const { server } = await tickServer({ TICK_INVOKER_EMAIL: undefined });
    expect((await postTick(server, `Bearer ${await idToken()}`)).statusCode).toBe(401);
    await server.close();
  });

  it("runs every step for the scheduler's token", async () => {
    const { server } = await tickServer();
    const response = await postTick(server, `Bearer ${await idToken()}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ ok: boolean; ran: string[] }>()).toEqual({
      ok: true,
      ran: ["flush", "push", "phase", "digest"],
    });
    await server.close();
  });
});

describe("what a tick runs", () => {
  it("sends the operator digest once in the digest hour, however many ticks arrive", async () => {
    const hour = new Date().getUTCHours();
    const { server, mailer } = await tickServer({
      INSTANCE_TIMEZONE: "UTC",
      INSTANCE_DIGEST_HOUR: String(hour),
    });
    await seedDocument(server, { slug: "doc", title: "Charter" });
    await seedParticipant(server, { document: "doc", person: "jane", token: "j".repeat(24) });
    await server.storage.commit(
      "send",
      { actor: { kind: "system" }, subject: "send: invitation for doc", document: "doc" },
      async (tx) => {
        await tx.participations.patch(
          { document: "doc", person: "jane" },
          { sent_at: new Date().toISOString(), notified: { invitation: new Date().toISOString() } },
        );
      },
    );

    const token = `Bearer ${await idToken()}`;
    expect((await postTick(server, token)).statusCode).toBe(200);
    expect((await postTick(server, token)).statusCode).toBe(200);

    const digests = (mailer as FakeMailer).sent.filter((m) =>
      m.subject.includes("today's activity"),
    );
    expect(digests).toHaveLength(1);
    await server.close();
  });

  it("flushes pending opens and closes a document whose signing window has passed", async () => {
    const { server } = await tickServer();
    await seedDocument(server, {
      slug: "doc",
      state: "open",
      signing_closes_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await seedParticipant(server, { document: "doc", person: "jane", token: "j".repeat(24) });
    server.storage.tracker.record("doc", "jane");

    expect((await postTick(server, `Bearer ${await idToken()}`)).statusCode).toBe(200);
    expect(server.storage.tracker.pendingCount()).toBe(0);
    expect(server.storage.readModel.getParticipation("doc", "jane")?.record.opens).toBe(1);
    expect(server.storage.readModel.getDocument("doc")?.record.state).toBe("closed");
    await server.close();
  });
});
