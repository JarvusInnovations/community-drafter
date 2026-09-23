import type { FastifyInstance } from "fastify";

import { isCurrentSigner, prefOn } from "../lib/notify.ts";
import type { ParticipationEntry } from "../storage/read-model.ts";

/**
 * Recipient derivation for the event keys that have no pre-existing
 * synchronous mark to reuse (`signing-opened`, `closed`, `closing-soon`,
 * `schedule-changed`) — `specs/behaviors/notifications.md` § Messages.
 * The three clock messages share `clockMessageRecipients`; `closed` and
 * `final-published`'s commenter half have rules of their own.
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
 * `specs/behaviors/notifications.md` § Sending: "A declined participant
 * hears nothing further about the clock or outcome." Declined is the
 * *current* position — the latest submitted judgement is `decline` and no
 * unrevoked signature stands. A later signature replaces the decline (the
 * signature check comes first, as in `participationStatus`), and re-opening
 * the link or starting a draft changes nothing, because only a submitted
 * judgement moves the position.
 */
function isDeclined(fastify: FastifyInstance, entry: ParticipationEntry): boolean {
  const signature = entry.record.signature;
  if (signature && signature.revoked !== true) return false;
  return (
    fastify.storage.readModel.getPosition(entry.record.document, entry.record.person)?.judgement ===
    "decline"
  );
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

/**
 * The **clock audience** — `specs/behaviors/notifications.md` § Sending:
 * "`signing-opened`, `closing-soon` and `schedule-changed` share one
 * recipient rule: an invitee with `phase_changes` who has opened their
 * personal link, is not a current signer and has not declined."
 *
 * Both exclusions are load-bearing. Someone who has only been sent an
 * invitation is left to the reminder machinery, which is the tool built for
 * the never-opened; telling them a deadline moved on a document they have
 * not looked at is noise. And a current signer has already done the thing
 * the clock counts down to, so the countdown is not news — the promise
 * their early signature was asked on is about the final text
 * (`specs/principles.md` § "Just sign it for now"), which `final-published`
 * keeps on its own. Revoking puts the person back in this set, because
 * `isCurrentSigner` is false again and nothing else about them changed.
 * A decliner is out for the same reason as a signer: they have already
 * answered what the clock asks (`isDeclined`).
 */
export function clockMessageRecipients(fastify: FastifyInstance, document: string): string[] {
  return eligibleParticipations(fastify, document)
    .filter((entry) => Boolean(entry.record.first_opened_at))
    .filter((entry) => !isCurrentSigner(entry))
    .filter((entry) => !isDeclined(fastify, entry))
    .filter((entry) => prefOn(entry, "phase_changes"))
    .map((entry) => entry.record.person);
}

/**
 * "signers and commenters with `phase_changes`" — not forced. `closed` is
 * deliberately *not* a clock message: it is the one terminal notice that
 * the list is final, which a signer is as entitled to as anyone, rather
 * than a countdown they have already answered. A declined participant is
 * the exception: they stepped out, and the outcome is not news to them.
 */
export function closedRecipients(fastify: FastifyInstance, document: string): string[] {
  return eligibleParticipations(fastify, document)
    .filter((entry) => !isDeclined(fastify, entry))
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
 * also told "the final version was published, every commenter". The
 * explicit `isDeclined` filter states the rule outright rather than leaving
 * it implied by the judgement test; the signer half needs no such filter
 * because a decliner holds no current signature.
 */
export function finalPublishedCommenterRecipients(
  fastify: FastifyInstance,
  document: string,
): string[] {
  return eligibleParticipations(fastify, document)
    .filter((entry) => !isCurrentSigner(entry))
    .filter((entry) => !isDeclined(fastify, entry))
    .filter((entry) => prefOn(entry, "phase_changes"))
    .filter((entry) => isCommenter(fastify, document, entry.record.person))
    .map((entry) => entry.record.person);
}
