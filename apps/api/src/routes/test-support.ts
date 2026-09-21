import Fastify, { type FastifyInstance } from "fastify";

import type {
  Audience,
  Capacity,
  DocumentState,
  PublicAccess,
  ShowSignatories,
} from "@signatories/shared";

import { app } from "../app.ts";
import { mintOperatorToken } from "../auth/tokens.ts";
import { FakeMailer, type Mailer } from "../lib/mailer/index.ts";
import type { Actor } from "../storage/actor.ts";
import { createTestDataRepo } from "../storage/test-helpers.ts";

export const TEST_ACTOR = { kind: "operator", email: "team@example.org" } as const satisfies Actor;

/**
 * Fixed test-only signing secret (>= 32 bytes, `env.ts`'s boot check) so
 * `TEST_ADMIN_TOKEN` below can be minted once, at module load, independent
 * of any particular server instance — every `buildTestServer()` call sets
 * this same `AUTH_SECRET` unless a test explicitly overrides it (none
 * currently do).
 */
export const TEST_AUTH_SECRET = "test-only-auth-secret-32-bytes-minimum!!";

/**
 * A `purpose: cli` bearer token for `TEST_ACTOR`, minted directly through
 * `auth/tokens.ts` rather than the HTTP device-code dance — the "dev
 * shortcut" the plan calls for, applied at the test-harness layer. Resolves
 * once at module load (top-level await), so every import sees the final
 * string. `buildTestServer()`'s default `BOOTSTRAP_OPERATOR_EMAIL` creates
 * the matching operator record at boot, so this token authenticates
 * against any freshly built test server without further setup.
 */
export const TEST_ADMIN_TOKEN = (
  await mintOperatorToken({
    purpose: "cli",
    email: TEST_ACTOR.email,
    name: "Team",
    kind: "person",
    secret: TEST_AUTH_SECRET,
  })
).token;

export interface BuildTestServerOptions {
  /** Defaults to a fresh `FakeMailer` — pass one in to assert on `.sent`/force failures. */
  mailer?: Mailer;
  /** Test-only override for the digest/closing-soon schedulers' poll interval. */
  schedulerIntervalMs?: number;
  /** Set env vars before boot (e.g. `DEV_ADMIN_EMAIL`, or `undefined` to unset one of the defaults below). */
  env?: Record<string, string | undefined>;
}

export async function buildTestServer(opts: BuildTestServerOptions = {}) {
  process.env.NODE_ENV = "test";
  process.env.AUTH_SECRET = TEST_AUTH_SECRET;
  process.env.BOOTSTRAP_OPERATOR_EMAIL = TEST_ACTOR.email;
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { dataDir, cleanup } = await createTestDataRepo();

  const mailer = opts.mailer ?? new FakeMailer();
  const server = Fastify();
  await server.register(app, {
    storage: { dataDir, trackerIntervalMs: 3_600_000 },
    disablePhaseObserver: true,
    notifications: {
      disableSchedulers: true,
      mailer,
      schedulerIntervalMs: opts.schedulerIntervalMs,
    },
  });
  await server.ready();

  return { server, dataDir, cleanup, mailer };
}

export function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
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
  public_access?: PublicAccess;
  /** `specs/data-model.md` § Audience — stored, and defaulted to `closed`
   * here so a seeded document looks like one an operator created. */
  audience?: Audience;
  addressed_to?: string[];
  reply_to?: string;
  sender_name?: string;
  /** Defaults to `[TEST_ACTOR.email]` — pass explicit operators for scoping tests. */
  operators?: string[];
  created_by?: string;
  /** `specs/behaviors/sites.md`: the site this document belongs to; absent = the default site. */
  site?: string;
}

export async function seedDocument(
  server: FastifyInstance,
  opts: SeedDocumentOptions,
): Promise<void> {
  await server.storage.commit(
    "create",
    { actor: TEST_ACTOR, subject: `create: ${opts.slug}`, document: opts.slug, site: opts.site },
    async (tx) => {
      await tx.documents.upsert({
        slug: opts.slug,
        site: opts.site,
        title: opts.title ?? opts.slug,
        state: opts.state ?? "open",
        body: opts.body ?? "Hello world.",
        comments_close_at: opts.comments_close_at,
        signing_closes_at: opts.signing_closes_at,
        capacities: opts.capacities,
        revocation_window_hours: opts.revocation_window_hours,
        show_signatories: opts.show_signatories,
        public_access: opts.public_access,
        audience: opts.audience ?? "closed",
        addressed_to: opts.addressed_to,
        reply_to: opts.reply_to,
        sender_name: opts.sender_name,
        created_by: opts.created_by ?? opts.operators?.[0] ?? TEST_ACTOR.email,
        operators: opts.operators ?? [TEST_ACTOR.email],
      });
    },
  );
}

export interface SeedSiteOptions {
  slug: string;
  hostname: string;
  name?: string;
  sender_name?: string;
  sender_email?: string;
  reply_to?: string;
  logo_url?: string;
  accent?: string;
  /** Defaults to `[TEST_ACTOR.email]`; pass explicit members for tenancy tests. */
  operators?: string[];
}

/** `specs/behaviors/sites.md`: one `sites` record — the identity a hostname carries. */
export async function seedSite(server: FastifyInstance, opts: SeedSiteOptions): Promise<void> {
  await server.storage.commit(
    "site-create",
    { actor: TEST_ACTOR, subject: `site-create: ${opts.slug}`, site: opts.slug },
    async (tx) => {
      await tx.sites.upsert({
        slug: opts.slug,
        hostname: opts.hostname,
        name: opts.name ?? opts.slug,
        sender_name: opts.sender_name,
        sender_email: opts.sender_email,
        reply_to: opts.reply_to ?? "team@example.org",
        logo_url: opts.logo_url,
        accent: opts.accent,
        operators: opts.operators ?? [TEST_ACTOR.email],
        created_by: opts.operators?.[0] ?? TEST_ACTOR.email,
      });
    },
  );
}

export interface SeedOperatorOptions {
  email: string;
  name?: string;
  superadmin?: boolean;
  active?: boolean;
}

export async function seedOperator(
  server: FastifyInstance,
  opts: SeedOperatorOptions,
): Promise<void> {
  const id = opts.email.split("@")[0]!.replace(/[^a-z0-9-]/gu, "-");
  await server.storage.commit(
    "operator-add",
    { actor: TEST_ACTOR, subject: `operator-add: ${opts.email}` },
    async (tx) => {
      await tx.operators.upsert({
        id,
        email: opts.email,
        name: opts.name ?? opts.email,
        kind: "person",
        active: opts.active ?? true,
        superadmin: opts.superadmin,
      });
    },
  );
}

/** A bearer token for one operator, minted on one site's host (`specs/api/auth.md` § Token shape). */
export async function bearerFor(
  email: string,
  site: string,
  name = email,
): Promise<Record<string, string>> {
  const minted = await mintOperatorToken({
    purpose: "cli",
    email,
    name,
    kind: "person",
    secret: TEST_AUTH_SECRET,
    site,
  });
  return { authorization: `Bearer ${minted.token}` };
}

export interface SeedParticipantOptions {
  document: string;
  person: string;
  token: string;
  email?: string;
  name?: string;
  notify?: {
    channel?: string;
    every_revision?: boolean;
    daily_digest?: boolean;
    phase_changes?: boolean;
    my_comments_addressed?: boolean;
    reminders?: boolean;
  };
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
        notify: opts.notify,
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
