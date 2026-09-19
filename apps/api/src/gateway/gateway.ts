import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { ApiError, forbidden, LINK_NOT_FOUND } from "../errors.ts";
import { constantTimeEquals } from "../lib/tokens.ts";
import type { Capability } from "./capability.ts";
import { FixedWindowLimiter } from "./rate-limit.ts";

export {
  ADMIN_ROUTE,
  PARTICIPANT_ROUTE,
  PUBLIC_ROUTE,
  type AdminPrincipal,
  type Capability,
  type ParticipantPrincipal,
  type Principal,
} from "./capability.ts";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Exported so tests can reset counters between cases without a fresh module load. */
export const tokenFailureLimiter = new FixedWindowLimiter(30, 60_000);
export const participantWriteLimiter = new FixedWindowLimiter(60, 60_000);

function actorLabelFromHeader(request: FastifyRequest): string {
  const header = request.headers["x-actor"];
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "cli";
}

/**
 * `specs/api/conventions.md` § Admin API: "cookie authenticated writes"
 * require this custom header — only same-origin JS can set it, so a
 * cross-site form POST can't forge one. Bearer traffic is exempt (checked
 * only on the cookie branch below), and reads never need it.
 */
function hasCsrfHeader(request: FastifyRequest): boolean {
  const header = request.headers["x-requested-with"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim().toLowerCase() === "drafter";
}

/**
 * `specs/api/conventions.md`: "Bearer and cookie are never mixed on one
 * request; a present `Authorization` header is decisive." A present header
 * resolves via bearer or fails outright — there is no fallback to the
 * cookie transport below. When the header is absent, `admin-dashboard`'s
 * cookie-session transport (Google OAuth via `auth/plugin.ts`) is tried
 * instead: cookie-authenticated writes additionally require the CSRF
 * header (`hasCsrfHeader` above).
 */
function resolveAdmin(request: FastifyRequest, fastify: FastifyInstance): void {
  const authHeader = request.headers.authorization;
  if (authHeader) {
    if (!authHeader.startsWith("Bearer ")) {
      throw new ApiError("unauthenticated", "An admin bearer token is required.");
    }

    const provided = authHeader.slice("Bearer ".length).trim();
    const expected = fastify.config.ADMIN_TOKEN;
    if (!expected || !constantTimeEquals(provided, expected)) {
      throw new ApiError("unauthenticated", "The admin bearer token is invalid.");
    }

    request.principal = {
      kind: "admin",
      actor: { kind: "cli", label: actorLabelFromHeader(request) },
    };
    return;
  }

  const session = fastify.auth.resolveSession(request.headers.cookie);
  if (!session) {
    throw new ApiError("unauthenticated", "An admin session or bearer token is required.");
  }
  if (WRITE_METHODS.has(request.method) && !hasCsrfHeader(request)) {
    throw new ApiError(
      "csrf_required",
      "Cookie-authenticated writes require the X-Requested-With: drafter header.",
    );
  }

  request.principal = {
    kind: "admin",
    actor: { kind: "admin", email: session.email },
  };
}

/**
 * `specs/behaviors/access-and-identity.md` § Personal links: unknown,
 * `link_revoked` or expired tokens all render the same 404 — "existence is
 * never disclosed" — so every failure branch below throws the one shared
 * `LINK_NOT_FOUND` instance (`plans/api-core.md` Validation: byte-identical
 * bodies). Failures also count against the per-source-address rate limit
 * (`specs/api/conventions.md` § Rate limits); a limited caller gets
 * `rate_limited` instead, which is itself not a disclosure (an attacker
 * already knows they're guessing).
 */
function resolveParticipant(request: FastifyRequest, fastify: FastifyInstance): void {
  const params = request.params as Record<string, string | undefined>;
  const token = params.token;

  const fail = (): never => {
    if (!tokenFailureLimiter.hit(request.ip)) {
      throw new ApiError("rate_limited", "Too many attempts. Try again in a minute.");
    }
    throw LINK_NOT_FOUND;
  };

  if (!token) return fail();

  const participation = fastify.storage.readModel.getParticipationByToken(token);
  if (!participation) return fail();
  if (participation.record.link_revoked) return fail();
  if (participation.record.expires_at && new Date(participation.record.expires_at) <= new Date()) {
    return fail();
  }

  request.principal = {
    kind: "participant",
    token,
    document: participation.record.document,
    person: participation.record.person,
  };

  if (WRITE_METHODS.has(request.method) && !participantWriteLimiter.hit(token)) {
    throw new ApiError("rate_limited", "Too many requests. Try again in a minute.");
  }
}

/**
 * The single global gateway hook (`jarvus-fastify` § Authentication: "one
 * global hook covers everything"). Every matched route must declare
 * `config.capability`; a missing declaration is denied at the *highest*
 * privilege (`forbidden`), never treated as open
 * (`plans/api-core.md` Validation: "An undeclared route returns 403").
 */
const gatewayPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request) => {
    const capability = request.routeOptions.config.capability as Capability | undefined;

    if (capability === undefined) {
      throw forbidden("admin");
    }
    if (capability === "public") {
      return;
    }
    if (capability === "admin") {
      resolveAdmin(request, fastify);
      return;
    }
    if (capability === "participant") {
      resolveParticipant(request, fastify);
      return;
    }
  });
};

export default fp(gatewayPlugin, "5.x");
