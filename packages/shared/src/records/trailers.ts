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
  // `specs/behaviors/sites.md` § Operators and tenancy: a site's identity
  // and its operator group are both ordinary admin actions, each one commit.
  "site-create",
  "site-update",
  "site-remove",
  "site-operator-add",
  "site-operator-remove",
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
 * One deadline moved by an `extend` or `reopen`: carried on the commit as
 * the `Deadlines` trailer and on the `schedule-changed` event. `from` is
 * absent when the document had no such deadline before.
 */
export interface DeadlineChange {
  deadline: "comments_close_at" | "signing_closes_at";
  from?: string;
  to: string;
}

/** What `Deadlines` writes where a deadline had no previous value. */
const DEADLINE_UNSET = "(unset)";

/**
 * `specs/data-model.md` → `Deadlines`: comma-separated `<field> <from> -> <to>`
 * in ISO 8601 UTC. One line, no spaces inside a timestamp, so it survives git's
 * trailer syntax unescaped. Returns `undefined` when nothing moved, so the
 * caller leaves the trailer off entirely rather than writing an empty one.
 */
export function formatDeadlinesTrailer(changes: DeadlineChange[]): string | undefined {
  if (changes.length === 0) return undefined;
  return changes
    .map((change) => `${change.deadline} ${change.from ?? DEADLINE_UNSET} -> ${change.to}`)
    .join(", ");
}

/** The inverse of `formatDeadlinesTrailer`; an unreadable entry is dropped. */
export function parseDeadlinesTrailer(value: string): DeadlineChange[] {
  const changes: DeadlineChange[] = [];
  for (const entry of value.split(",")) {
    const match = /^(\S+)\s+(\S+)\s+->\s+(\S+)$/u.exec(entry.trim());
    if (!match) continue;
    const [, deadline, from, to] = match;
    if (deadline !== "comments_close_at" && deadline !== "signing_closes_at") continue;
    if (to === undefined) continue;
    changes.push({
      deadline,
      ...(from !== undefined && from !== DEADLINE_UNSET ? { from } : {}),
      to,
    });
  }
  return changes;
}

/**
 * The full trailer set. All fields are optional here — which trailers apply
 * to a given commit depends on its `Action` (see the table in
 * `specs/data-model.md`); the storage layer's `commit()` wrapper is what
 * enforces per-action shape.
 */
export interface Trailers {
  Action: Action;
  Document?: string;
  /** `specs/data-model.md`: every commit about a site, and every commit about a document that belongs to one. */
  Site?: string;
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
  Deadlines?: string;
  Reason?: string;
  "Request-Id"?: string;
}
