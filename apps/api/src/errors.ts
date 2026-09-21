/**
 * `specs/api/conventions.md` § Responses — the JSON error envelope
 * `{ error, message, details }` and the status table. Every route in this
 * plan throws `ApiError` (or lets Fastify's schema validator fail, which the
 * error handler registered in `app.ts` maps to `invalid_request`); nothing
 * hand-rolls `reply.status().send()` for an error case.
 */

export type ErrorCode =
  | "invalid_request"
  | "invalid_anchor"
  | "judgement_requires_comments"
  | "attestation_required"
  | "unauthenticated"
  | "operator_inactive"
  | "forbidden"
  | "csrf_required"
  | "not_found"
  | "phase_closed"
  | "version_stale"
  | "deadline_not_later"
  | "no_deadline_set"
  | "stale_edit"
  | "unsaved_items"
  | "no_change"
  | "no_version"
  | "already_exists"
  | "already_sent"
  | "has_activity"
  | "last_operator"
  | "refresh_busy"
  | "refresh_diverged"
  | "device_pending"
  | "validation_failed"
  | "rate_limited"
  | "internal_error";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_anchor: 400,
  judgement_requires_comments: 400,
  attestation_required: 400,
  unauthenticated: 401,
  operator_inactive: 401,
  forbidden: 403,
  csrf_required: 403,
  not_found: 404,
  phase_closed: 409,
  version_stale: 409,
  deadline_not_later: 409,
  no_deadline_set: 422,
  stale_edit: 409,
  unsaved_items: 409,
  no_change: 409,
  last_operator: 409,
  refresh_busy: 409,
  refresh_diverged: 409,
  device_pending: 409,
  // `specs/api/admin.md` § Documents → `POST .../open`: "Errors:
  // `validation_failed` (order), `no_version`." Not in `conventions.md`'s
  // status table (which predates this endpoint's detail); grouped with the
  // other 409 preconditions since it's the same shape — a well-formed
  // request the current record state can't satisfy.
  no_version: 409,
  // `specs/api/admin.md` § Operators: "409 when the email exists." Generic
  // conflict-on-create, distinct from `validation_failed` (which the
  // documents-create route uses for its own slug conflict — a pre-existing
  // inconsistency this plan doesn't relitigate, see the plan's Notes).
  already_exists: 409,
  // `specs/api/admin.md` § People and invitations: `DELETE .../invitations/:person`.
  already_sent: 409,
  has_activity: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

/**
 * `not_found` for unknown/revoked/expired participant tokens and
 * non-public documents must be **byte-identical** (`plans/api-core.md`
 * Validation) — existence is never disclosed
 * (`specs/behaviors/access-and-identity.md`). One shared instance so every
 * caller produces exactly the same body.
 */
export const LINK_NOT_FOUND = new ApiError(
  "not_found",
  "This link isn't available. If you believe this is a mistake, please contact the team that sent it to you.",
);

export function forbidden(required: string): ApiError {
  return new ApiError("forbidden", `This action requires ${required} access.`, { required });
}

/**
 * `specs/api/admin.md`: "a caller who is not one of the document's
 * operators gets 404 `not_found`, identical to an unknown slug." One
 * function so the gateway's document-scoping check (`gateway.ts`) and every
 * route's own "no such document" branch produce byte-identical bodies.
 */
export function notFoundDocument(slug: string): ApiError {
  return new ApiError("not_found", `No document '${slug}'.`);
}
