import { AxiError } from "axi-sdk-js";

/**
 * The admin API's own error envelope (`specs/api/conventions.md` §
 * Responses): `{ error, message, details }`. Carries the API's error code
 * and details through so `cli.ts` can map it to the CLI's own exit code and
 * render the API's `message` verbatim (`specs/api/admin-cli.md` § Output
 * rules: "the message is the API's `message`").
 */
export class ApiCallError extends AxiError {
  readonly details: Record<string, unknown>;

  constructor(apiCode: string, message: string, details: Record<string, unknown> = {}) {
    super(message, apiCode, []);
    this.details = details;
  }
}

/** A transport-level failure (connection refused, DNS, timeout) — not an API error envelope. */
export class NetworkError extends AxiError {
  constructor(message: string) {
    super(message, "NETWORK_ERROR", ["Check DRAFTER_URL and that the API is reachable"]);
  }
}

/**
 * `specs/api/admin-cli.md` § Output rules: "Errors map API `error` codes to
 * exit codes: 2 validation, 3 phase/conflict, 4 not found, 5 auth, 1 other."
 * CLI-level usage errors (missing/unknown flags) are validation errors too,
 * so they share the 2 bucket alongside the API's own validation codes.
 */
const EXIT_CODE_BY_CODE: Record<string, number> = {
  // CLI-level usage errors (thrown by flags.ts / config.ts).
  USAGE: 2,
  UNKNOWN_FLAG: 2,
  VALIDATION_ERROR: 2,

  // API validation-shaped errors (400/422).
  invalid_request: 2,
  validation_failed: 2,
  invalid_anchor: 2,
  judgement_requires_comments: 2,
  attestation_required: 2,

  // API phase/conflict errors (409).
  phase_closed: 3,
  version_stale: 3,
  deadline_not_later: 3,
  stale_edit: 3,
  unsaved_items: 3,
  no_change: 3,
  no_version: 3,

  // Not found (404).
  not_found: 4,

  // Auth (401/403).
  unauthenticated: 5,
  forbidden: 5,
  csrf_required: 5,

  // Everything else (rate limits, internal errors, network failures).
  rate_limited: 1,
  internal_error: 1,
  NETWORK_ERROR: 1,
};

export function exitCodeForCode(code: string): number {
  return EXIT_CODE_BY_CODE[code] ?? 1;
}
