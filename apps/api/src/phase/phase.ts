import type { DocumentRecord } from "@community-drafter/shared";

import { ApiError } from "../errors.ts";

/**
 * `specs/behaviors/document-lifecycle.md` § Rule. `document.state` is
 * `draft` | `open` | `closed` | `withdrawn`; within `open` the phase is
 * derived at read time from the two deadlines. This module's `derivePhase`
 * never mutates the record — the actual `state = closed` flip on the clock
 * crossing is the phase observer's job (`events/phase-observer.ts`), so a
 * read never has a side effect.
 */
export type Phase = "draft" | "commenting" | "signing" | "closed" | "withdrawn";

export function derivePhase(document: DocumentRecord, now: Date): Phase {
  if (document.state === "withdrawn") return "withdrawn";
  if (document.state === "draft") return "draft";
  if (document.state === "closed") return "closed";

  // state === "open": both deadlines are required by `open` (admin.md), but
  // guard defensively rather than throw if a record is somehow missing one.
  const commentsCloseAt = document.comments_close_at ? new Date(document.comments_close_at) : null;
  const signingClosesAt = document.signing_closes_at ? new Date(document.signing_closes_at) : null;

  if (commentsCloseAt && now < commentsCloseAt) return "commenting";
  if (signingClosesAt && now < signingClosesAt) return "signing";
  if (signingClosesAt) return "closed";
  // No signing deadline set yet (shouldn't happen for an `open` document,
  // but fail toward the more permissive "commenting" rather than throwing).
  return "commenting";
}

/**
 * The allowed-actions table (`specs/behaviors/document-lifecycle.md` §
 * "What each phase allows"), restricted to the actions this plan's write
 * endpoints assert. `read` phases beyond this table (draft/withdrawn admin
 * viewing, public "withdrawn" notice) are handled by the routes themselves,
 * not by `assertPhase`.
 */
export type LifecycleAction =
  | "sign"
  | "revoke_signature"
  | "decline"
  | "change_prefs"
  | "admin_publish"
  | "admin_invite";

/** Which deadline a blocked action's `phase_closed` details should name. */
const DEADLINE_KEY: Record<LifecycleAction, "comments_close_at" | "signing_closes_at"> = {
  sign: "signing_closes_at",
  revoke_signature: "signing_closes_at",
  decline: "signing_closes_at",
  change_prefs: "signing_closes_at",
  admin_publish: "signing_closes_at",
  admin_invite: "signing_closes_at",
};

const ALLOWED: Record<LifecycleAction, ReadonlySet<Phase>> = {
  sign: new Set(["commenting", "signing"]),
  revoke_signature: new Set(["commenting", "signing"]),
  decline: new Set(["commenting", "signing"]),
  change_prefs: new Set(["commenting", "signing", "closed", "withdrawn"]),
  admin_publish: new Set(["draft", "commenting", "signing"]),
  admin_invite: new Set(["draft", "commenting", "signing"]),
};

/**
 * Assert `action` is allowed in `document`'s current phase (computed at
 * `now`), or throw `ApiError('phase_closed', …)` with
 * `{ phase, comments_close_at | signing_closes_at }` in `details`, per
 * `specs/api/conventions.md`. Returns the current phase on success so
 * callers don't have to call `derivePhase` twice.
 */
export function assertPhase(document: DocumentRecord, now: Date, action: LifecycleAction): Phase {
  const phase = derivePhase(document, now);
  if (ALLOWED[action].has(phase)) return phase;

  const key = DEADLINE_KEY[action];
  const deadline = document[key];
  throw new ApiError("phase_closed", phaseClosedMessage(action, phase), {
    phase,
    ...(deadline !== undefined ? { [key]: deadline } : {}),
  });
}

function phaseClosedMessage(action: LifecycleAction, phase: Phase): string {
  if (phase === "withdrawn") return "This document was withdrawn.";
  if (phase === "draft") return "This document has not opened yet.";
  switch (action) {
    case "sign":
    case "revoke_signature":
    case "decline":
      return "Signing has closed for this document.";
    case "admin_publish":
      return "This document is closed; reopen it to publish a new version.";
    case "admin_invite":
      return "This document is closed; reopen it to invite more people.";
    case "change_prefs":
      return "Preferences can no longer be changed.";
  }
}
