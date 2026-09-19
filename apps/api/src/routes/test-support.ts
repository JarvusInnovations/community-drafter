import Fastify, { type FastifyInstance } from "fastify";

import type { Capacity, DocumentState, ShowSignatories } from "@community-drafter/shared";

import { app } from "../app.ts";
import type { Actor } from "../storage/actor.ts";
import { createTestDataRepo } from "../storage/test-helpers.ts";

export const TEST_ACTOR: Actor = { kind: "admin", email: "team@example.org" };

export const TEST_ADMIN_TOKEN = "s3cr3t-admin-token";

export async function buildTestServer() {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  const { dataDir, cleanup } = await createTestDataRepo();

  const server = Fastify();
  await server.register(app, {
    storage: { dataDir, trackerIntervalMs: 3_600_000 },
    disablePhaseObserver: true,
  });
  await server.ready();

  return { server, dataDir, cleanup };
}

export function adminHeaders(actorLabel?: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
  if (actorLabel) headers["x-actor"] = actorLabel;
  return headers;
}

export interface SeedDocumentOptions {
  slug: string;
  title?: string;
  body?: string;
  state?: DocumentState;
  comments_close_at?: string;
  signing_closes_at?: string;
  capacities?: Capacity[];
  revocation_window_hours?: number;
  show_signatories?: ShowSignatories;
}

export async function seedDocument(
  server: FastifyInstance,
  opts: SeedDocumentOptions,
): Promise<void> {
  await server.storage.commit(
    "create",
    { actor: TEST_ACTOR, subject: `create: ${opts.slug}`, document: opts.slug },
    async (tx) => {
      await tx.documents.upsert({
        slug: opts.slug,
        title: opts.title ?? opts.slug,
        state: opts.state ?? "open",
        body: opts.body ?? "Hello world.",
        comments_close_at: opts.comments_close_at,
        signing_closes_at: opts.signing_closes_at,
        capacities: opts.capacities,
        revocation_window_hours: opts.revocation_window_hours,
        show_signatories: opts.show_signatories,
      });
    },
  );
}

export interface SeedParticipantOptions {
  document: string;
  person: string;
  token: string;
  email?: string;
  name?: string;
}

export async function seedParticipant(
  server: FastifyInstance,
  opts: SeedParticipantOptions,
): Promise<void> {
  await server.storage.commit(
    "invite",
    {
      actor: TEST_ACTOR,
      subject: `invite: ${opts.person} on ${opts.document}`,
      document: opts.document,
    },
    async (tx) => {
      await tx.people.upsert({
        id: opts.person,
        name: opts.name ?? opts.person,
        email: opts.email ?? `${opts.person}@example.org`,
        source: "admin",
      });
      await tx.participations.upsert({
        document: opts.document,
        person: opts.person,
        token: opts.token,
        source: "admin",
      });
    },
  );
}

export async function commitCount(dataDir: string): Promise<number> {
  const proc = Bun.spawn(["git", "rev-list", "--count", "HEAD"], {
    cwd: dataDir,
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return Number(stdout.trim());
}
