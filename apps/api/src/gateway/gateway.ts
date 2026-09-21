import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { ApiError, forbidden, LINK_NOT_FOUND, notFoundDocument } from "../errors.ts";
import type { Capability } from "./capability.ts";
import { FixedWindowLimiter } from "./rate-limit.ts";

export {
  DOCUMENT_SCOPED_ROUTE,
  OPERATOR_ROUTE,
  PARTICIPANT_ROUTE,
  PUBLIC_ROUTE,
  WEBHOOK_ROUTE,
  type Capability,
  type OperatorPrincipal,
  type ParticipantPrincipal,
  type Principal,
} from "./capability.ts";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Exported so tests can reset counters between cases without a fresh module load. */
export const tokenFailureLimiter = new FixedWindowLimiter(30, 60_000);
export const participantWriteLimiter = new FixedWindowLimiter(60, 60_000);

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
 * `specs/behaviors/operators.md` § Sessions: "Every request with a token
 * loads the operator record; `active = false` or a missing record means
 * 401, regardless of the token's validity." Missing record → the generic
 * `unauthenticated` (the token itself might be fine, but nothing about it
 * is disclosed); present-but-inactive → the more specific `operator_inactive`
 * so a deactivated operator's own client can say why.
 */
function loadActiveOperator(
  fastify: FastifyInstance,
  email: string,
): { email: string; name: string; kind: "person" | "bot"; superadmin: boolean } {
  const record = fastify.storage.readModel.getOperatorByEmail(email);
  if (!record) {
    throw new ApiError("unauthenticated", "No operator record for this token.");
  }
  if (!record.active) {
    throw new ApiError("operator_inactive", "This operator account has been deactivated.");
  }
  return {
    email: record.email,
    name: record.name,
    kind: record.kind,
    superadmin: record.superadmin === true,
  };
}

/**
 * `specs/behaviors/operators.md` § Sessions + `specs/api/conventions.md`:
 * "Bearer and cookie are never mixed on one request; a present
 * `Authorization` header is decisive." A present header resolves via
 * bearer or fails outright — never falls back to the cookie below.
 */
async function resolveOperator(request: FastifyRequest, fastify: FastifyInstance): Promise<void> {
  const authHeader = request.headers.authorization;

  if (authHeader) {
    if (!authHeader.startsWith("Bearer ")) {
      throw new ApiError("unauthenticated", "An operator bearer token is required.");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const verified = await fastify.auth.verifyBearer(token);
    if (!verified) {
      throw new ApiError("unauthenticated", "The bearer token is invalid or expired.");
    }
    const operator = loadActiveOperator(fastify, verified.sub);
    request.principal = {
      kind: "operator",
      email: operator.email,
      name: operator.name,
      operatorKind: operator.kind,
      superadmin: operator.superadmin,
      transport: "bearer",
      exp: verified.exp,
    };
    return;
  }

  const verified = await fastify.auth.resolveCookie(request.headers.cookie);
  if (!verified) {
    throw new ApiError("unauthenticated", "An operator session or bearer token is required.");
  }
  if (WRITE_METHODS.has(request.method) && !hasCsrfHeader(request)) {
    throw new ApiError(
      "csrf_required",
      "Cookie-authenticated writes require the X-Requested-With: drafter header.",
    );
  }
  const operator = loadActiveOperator(fastify, verified.sub);
  request.principal = {
    kind: "operator",
    email: operator.email,
    name: operator.name,
    operatorKind: operator.kind,
    superadmin: operator.superadmin,
    transport: "cookie",
    exp: verified.exp,
  };
}

/**
 * `specs/api/admin.md`: "Document routes are scoped: a caller who is not
 * one of the document's operators gets 404 `not_found`, identical to an
 * unknown slug" — so document existence is never disclosed to a non-member
 * either. Every `documentScoped` route names its document via a `:slug`
 * route param.
 */
function enforceDocumentScope(request: FastifyRequest, fastify: FastifyInstance): void {
  const principal = request.principal;
  if (!principal || principal.kind !== "operator") {
    throw forbidden("operator");
  }
  const slug = (request.params as Record<string, string | undefined>).slug;
  if (!slug) {
    throw new Error("documentScoped route reached with no :slug param");
  }
  // `behaviors/operators.md` § Superadmins: a superadmin passes document
  // scoping everywhere; an unknown slug is still a 404 for everyone.
  const entry = fastify.storage.readModel.getDocument(slug);
  if (!entry || (!principal.superadmin && !entry.record.operators?.includes(principal.email))) {
    throw notFoundDocument(slug);
  }
}

/**
 * `specs/behaviors/operators.md` § Data-repository refresh (webhook):
 * "authenticated by an HMAC signature over the body with
 * `DATA_REPO_WEBHOOK_SECRET` (GitHub's `X-Hub-Signature-256`)." Never an
 * operator token — this is the one capability with no notion of a
 * principal at all.
 */
function resolveWebhook(request: FastifyRequest, fastify: FastifyInstance): void {
  const secret = fastify.config.DATA_REPO_WEBHOOK_SECRET;
  const header = request.headers["x-hub-signature-256"];
  const signature = Array.isArray(header) ? header[0] : header;

  if (!secret || !signature || !signature.startsWith("sha256=")) {
    throw new ApiError("unauthenticated", "A valid webhook signature is required.");
  }

  const raw = request.rawBody ?? Buffer.alloc(0);
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError("unauthenticated", "A valid webhook signature is required.");
  }
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
 * privilege (`forbidden`), never treated as open.
 */
const gatewayPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request) => {
    // `specs/api/conventions.md`: deny-by-default governs *routes*, not
    // addresses a person typed. Nothing matched here, so there is no route
    // to have declared a capability and nothing to protect — the request
    // goes on to the not-found handler, which answers 404 (the app's own
    // "isn't available" page for an HTML GET). Denying instead turned every
    // mistyped URL under the instance into a raw JSON 403 (#60).
    if (request.routeOptions.url === undefined) {
      return;
    }

    const capability = request.routeOptions.config.capability as Capability | undefined;

    if (capability === undefined) {
      throw forbidden("operator");
    }
    if (capability === "public") {
      return;
    }
    if (capability === "webhook") {
      resolveWebhook(request, fastify);
      return;
    }
    if (capability === "operator") {
      await resolveOperator(request, fastify);
      if (request.routeOptions.config.documentScoped) {
        enforceDocumentScope(request, fastify);
      }
      return;
    }
    if (capability === "participant") {
      resolveParticipant(request, fastify);
      return;
    }
  });
};

export default fp(gatewayPlugin, "5.x");
