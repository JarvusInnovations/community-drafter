import type { Actor } from "../storage/actor.ts";

/**
 * `specs/architecture.md` § API server lists four capabilities
 * (`participant`, `admin-user`, `admin-token`, `public`); `plans/api-core.md`
 * narrows this to three for phase 1 — `admin-user` (the OAuth cookie
 * session) is the `admin-dashboard` plan's territory. Every route declares
 * one of these three in its `config`; an undeclared route is denied by
 * default (`gateway.ts`).
 */
export type Capability = "participant" | "admin" | "public";

export const PARTICIPANT_ROUTE = { capability: "participant" as const };
export const ADMIN_ROUTE = { capability: "admin" as const };
export const PUBLIC_ROUTE = { capability: "public" as const };

/** Set by the gateway once a `participant` route's token resolves. */
export interface ParticipantPrincipal {
  kind: "participant";
  token: string;
  document: string;
  person: string;
}

/**
 * Set by the gateway once an `admin` route's bearer token checks out. This
 * plan only ever produces the `cli` actor form — a cookie-authenticated
 * admin-user principal (which would carry `{ kind: "admin"; email }`) is
 * `admin-dashboard`'s addition once that transport exists.
 */
export interface AdminPrincipal {
  kind: "admin";
  actor: Actor;
}

export type Principal = ParticipantPrincipal | AdminPrincipal;

declare module "fastify" {
  interface FastifyContextConfig {
    capability?: Capability;
  }

  interface FastifyRequest {
    principal?: Principal;
  }
}
