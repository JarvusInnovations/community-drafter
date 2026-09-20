import type { OperatorKind } from "@community-drafter/shared";

/**
 * `specs/api/conventions.md`: "every route declares `participant`,
 * `operator`, `webhook`, or `public`; undeclared routes fail closed."
 * Replaces the old three-capability (`participant`/`admin`/`public`) set —
 * `admin` is gone, `operator` takes its place (`plans/operators-auth.md`),
 * and `webhook` is new (the `refresh` route's HMAC-signature transport,
 * never an operator token).
 */
export type Capability = "participant" | "operator" | "webhook" | "public";

export const PARTICIPANT_ROUTE = { capability: "participant" as const };
export const PUBLIC_ROUTE = { capability: "public" as const };
export const WEBHOOK_ROUTE = { capability: "webhook" as const };

/** An operator route with no document-membership scoping (e.g. `GET /documents`, `/operators`, `/whoami`). */
export const OPERATOR_ROUTE = { capability: "operator" as const };

/**
 * `specs/api/admin.md`: "Document routes are scoped: a caller who is not
 * one of the document's operators gets 404 `not_found`." Every route under
 * `/admin/api/documents/:slug/*` declares this instead of `OPERATOR_ROUTE` —
 * the gateway reads `request.params.slug` after resolving the operator
 * principal and checks `documents.operators` before the handler ever runs.
 */
export const DOCUMENT_SCOPED_ROUTE = { capability: "operator" as const, documentScoped: true };

/** Set by the gateway once a `participant` route's token resolves. */
export interface ParticipantPrincipal {
  kind: "participant";
  token: string;
  document: string;
  person: string;
}

/**
 * Set by the gateway once an `operator` route's bearer or cookie token
 * checks out and the live `operators` record is active. `transport` and
 * `exp` (the verified token's expiry, unix seconds) are carried so
 * `GET /auth/session` / `GET /whoami` can report them without re-verifying
 * the token, and so `POST /auth/refresh` can enforce "bearer only".
 */
export interface OperatorPrincipal {
  kind: "operator";
  email: string;
  name: string;
  operatorKind: OperatorKind;
  /** `behaviors/operators.md` § Superadmins — re-read from the operator record on every request. */
  superadmin: boolean;
  transport: "bearer" | "cookie";
  exp: number;
}

export type Principal = ParticipantPrincipal | OperatorPrincipal;

declare module "fastify" {
  interface FastifyContextConfig {
    capability?: Capability;
    /** Additionally require the resolved operator to be a member of the route's `:slug` document. */
    documentScoped?: boolean;
  }

  interface FastifyRequest {
    principal?: Principal;
    /**
     * Raw request-body bytes, decorated only within the encapsulated
     * context that registers a raw-body content-type parser (currently
     * just `routes/admin/instance.ts`'s `/refresh` webhook route) —
     * `webhook` capability's HMAC signature check needs the exact bytes
     * `X-Hub-Signature-256` was computed over, not a re-serialized parse.
     */
    rawBody?: Buffer;
  }
}
