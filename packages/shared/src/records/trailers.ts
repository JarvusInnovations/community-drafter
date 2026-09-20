/**
 * The trailer set from `specs/data-model.md` → "Commits are the events". Every
 * mutation to the data repo is one `repo.transact` commit; the trailers below
 * carry the structured facts an agent or a dashboard reads back with
 * `git log` / `git interpret-trailers --parse`. Keys use HTTP-style casing to
 * match gitsheets' `trailers` transaction option and real git trailer syntax.
 */

/** `Action` trailer values, in the order `specs/data-model.md` lists them. */
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
  // Additive (`api-core`): `specs/api/admin.md` names both a "links export"
  // action ("recorded as an admin event with the count exported") and a
  // per-invitation `expire` endpoint, but `specs/data-model.md`'s trailer
  // table (predating this plan) only lists `link-revoke`/`link-reissue`.
  // Follow-up: fold these two into that table.
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
  Disposed?: string;
  Reason?: string;
  "Request-Id"?: string;
}
