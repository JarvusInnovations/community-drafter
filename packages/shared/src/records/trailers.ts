/**
 * The trailer set from `specs/data-model.md` → "Commits are the events". Every
 * mutation to the data repo is one `repo.transact` commit; the trailers below
 * carry the structured facts an agent or a dashboard reads back with
 * `git log` / `git interpret-trailers --parse`. Keys use HTTP-style casing to
 * match gitsheets' `trailers` transaction option and real git trailer syntax.
 */

/**
 * `Action` trailer values. `specs/data-model.md`'s "Commits are the events"
 * table is the canonical list: this array is the same values in the same
 * order, and a new action goes into that row first.
 */
export const ACTIONS = [
  "create",
  "settings",
  "open",
  "extend",
  "close",
  "reopen",
  "withdraw",
  "publish",
  "invite",
  "send",
  "sign",
  "resign",
  "revoke",
  "comment",
  "submit",
  "prefs",
  "track",
  "admin-revoke",
  "link-revoke",
  "link-reissue",
  // `specs/api/admin.md` § People and invitations: the links export
  // ("recorded as an admin event with the count exported") and the
  // per-invitation `expire` endpoint.
  "link-export",
  "link-expire",
  // `specs/api/admin.md` § People and invitations: removing a not-yet-sent invitation.
  "uninvite",
  // `specs/behaviors/operators.md`: operator lifecycle and per-document
  // membership changes are ordinary admin actions, each one commit.
  "operator-add",
  "operator-update",
  "operator-remove",
  "doc-operator-add",
  "doc-operator-remove",
] as const;

export type Action = (typeof ACTIONS)[number];

/** `Judgement` trailer values, set by the `submit` commit. */
export const JUDGEMENTS = ["sign", "sign_conditional", "comment", "decline"] as const;

export type Judgement = (typeof JUDGEMENTS)[number];

/**
 * `Signature` trailer values (`specs/behaviors/signatures.md` § Signing:
 * "Signing through comment mode is the same signature by another door").
 * Set on a `submit` commit that also writes the participation's `signature`
 * table, so the sign/resign/revoke history reads the same whichever door the
 * signature came through.
 */
export const SIGNATURE_TRAILERS = ["sign", "resign", "revoke"] as const;

export type SignatureTrailer = (typeof SIGNATURE_TRAILERS)[number];

/**
 * The full trailer set. All fields are optional here — which trailers apply
 * to a given commit depends on its `Action` (see the table in
 * `specs/data-model.md`); the storage layer's `commit()` wrapper is what
 * enforces per-action shape.
 */
export interface Trailers {
  Action: Action;
  Document?: string;
  Person?: string;
  Actor: string;
  Version?: number;
  Summary?: string;
  Final?: "true";
  Notes?: string;
  Submission?: string;
  Judgement?: Judgement;
  Signature?: SignatureTrailer;
  Disposed?: string;
  Reason?: string;
  "Request-Id"?: string;
}
