import type { FastifyInstance } from "fastify";

import { isCurrentSigner, prefOn } from "../lib/notify.ts";

/**
 * Recipient derivation for the event keys that have no pre-existing
 * synchronous mark to reuse (`signing-opened`, `closed`, `closing-soon`,
 * `schedule-changed`) — `specs/behaviors/notifications.md` § Messages.
 * `dispatcher.deliver` still does the `notified` idempotency skip and the
 * batched mark-on-success commit; these just answer "who's eligible" from
 * live preferences.
 */
function eligibleParticipations(fastify: FastifyInstance, document: string) {
  return fastify.storage.readModel
    .listParticipationsForDocument(document)
    .filter((entry) => !entry.record.link_revoked);
}

/**
 * "Commenter", for `final-published`'s purposes, is narrower than "has a
 * submitted submission": a decliner's position is `decline`, a distinct
 * derived status from `commented` (`specs/data-model.md`'s "Derived
 * participant status" line lists `commented` / `signed` / `signed
 * (conditional)` / `declined` as siblings, not one subsuming another), so a
 * decliner should not also count as a commenter here. Now that `comment-mode`
 * has landed the general `submit` endpoint, the person's latest *position*
 * (`ReadModel.getPosition`) is judgement-typed, so this checks that
 * directly instead of the broader "submitted anything" test this function
 * used before `comment`/`sign`/`sign_conditional` submissions existed.
 */
function isCommenter(fastify: FastifyInstance, document: string, person: string): boolean {
  return fastify.storage.readModel.getPosition(document, person)?.judgement === "comment";
}

/** "all invitees with `phase_changes` who have opened the link, plus every current signer regardless". */
export function signingOpenedRecipients(fastify: FastifyInstance, document: string): string[] {
  const people = new Set<string>();
  for (const entry of eligibleParticipations(fastify, document)) {
    const opened = Boolean(entry.record.first_opened_at);
    if ((opened && prefOn(entry, "phase_changes")) || isCurrentSigner(entry)) {
      people.add(entry.record.person);
    }
  }
  return [...people];
}

/** "current signers" — forced on. */
export function closingSoonRecipients(fastify: FastifyInstance, document: string): string[] {
  return eligibleParticipations(fastify, document)
    .filter(isCurrentSigner)
    .map((entry) => entry.record.person);
}

/** "signers and commenters with `phase_changes`" — not forced. */
export function closedRecipients(fastify: FastifyInstance, document: string): string[] {
  return eligibleParticipations(fastify, document)
    .filter((entry) => prefOn(entry, "phase_changes"))
    .map((entry) => entry.record.person);
}

/** "invitees with `phase_changes`". */
export function scheduleChangedRecipients(fastify: FastifyInstance, document: string): string[] {
  return eligibleParticipations(fastify, document)
    .filter((entry) => prefOn(entry, "phase_changes"))
    .map((entry) => entry.record.person);
}

/**
 * `final-published`'s commenter half — "every commenter with
 * `phase_changes`" — the current signer half is computed and pre-marked
 * synchronously by `lib/notify.ts`'s `dispatchPublishNotifications`
 * alongside `v<n>`/`disposition-v<n>`; this is the complement so the
 * dispatcher's `final-published` delivery covers both. `isCommenter` reads
 * this narrowly (judgement `comment` specifically) so a decliner isn't
 * also told "the final version was published, every commenter" — they get
 * `closed`/`schedule-changed` like any other invitee instead.
 */
export function finalPublishedCommenterRecipients(
  fastify: FastifyInstance,
  document: string,
): string[] {
  return eligibleParticipations(fastify, document)
    .filter((entry) => !isCurrentSigner(entry))
    .filter((entry) => prefOn(entry, "phase_changes"))
    .filter((entry) => isCommenter(fastify, document, entry.record.person))
    .map((entry) => entry.record.person);
}
