import type { FastifyInstance } from "fastify";

import type { Actor } from "../storage/actor.ts";
import type { ParticipationEntry } from "../storage/read-model.ts";

type NotifyPrefKey =
  | "every_revision"
  | "daily_digest"
  | "phase_changes"
  | "my_comments_addressed"
  | "reminders";

/** `specs/behaviors/notifications.md` § Defaults. */
const DEFAULT_ON: Record<NotifyPrefKey, boolean> = {
  every_revision: false,
  daily_digest: false,
  phase_changes: true,
  my_comments_addressed: true,
  reminders: true,
};

export function prefOn(entry: ParticipationEntry, key: NotifyPrefKey): boolean {
  const value = entry.record.notify?.[key];
  return value ?? DEFAULT_ON[key];
}

/**
 * `notified` keys that record an operator action rather than a message to
 * the person — `specs/data-model.md`: "`notified."links-exported"` is an
 * operator's CSV export, not a message."
 */
const NOT_A_MESSAGE = new Set(["links-exported"]);

/**
 * When this document last reached this person, or `undefined` if it never
 * has (`specs/behaviors/notifications.md` § Sending, the reminder
 * interval: "any recorded send to that person on this document").
 * `notified` holds a timestamp per delivered message plus a couple of
 * non-timestamp entries — the numeric `reminder` count, the `digest`
 * date — so this takes the newest value that reads as a date and ignores
 * the rest.
 */
export function lastMessagedAt(entry: ParticipationEntry): string | undefined {
  let newest: string | undefined;
  for (const [key, value] of Object.entries(entry.record.notified ?? {})) {
    if (NOT_A_MESSAGE.has(key)) continue;
    if (typeof value !== "string") continue;
    if (Number.isNaN(new Date(value).getTime())) continue;
    if (newest === undefined || new Date(value) > new Date(newest)) newest = value;
  }
  return newest;
}

/** `specs/behaviors/signatures.md` § Display: current signatory. */
export function isCurrentSigner(entry: ParticipationEntry): boolean {
  const signature = entry.record.signature;
  return Boolean(signature) && signature?.revoked !== true && signature?.display_approved === true;
}

export interface PublishNotifyCounts {
  every_revision: number;
  dispositions: number;
  signers: number;
}

export interface PublishDispositionRecipient {
  person: string;
  outcomes: Array<{ outcome: string; note?: string }>;
}

export interface PublishFinalRecipient {
  person: string;
  conditional: boolean;
}

/**
 * Who this publish just marked, grouped by event key -- handed to
 * `notifications`'s dispatcher (`notifications/dispatcher.ts`) so it can
 * render and send `v<n>` / `disposition-v<n>` / `final-published` without
 * re-deriving the recipient set (`plans/notifications.md` Approach: "reuse
 * `lib/notify.ts`'s recipient computation rather than re-deriving it").
 * `final_published` covers only current signers -- `notifications.md`'s
 * behavior table also sends `final-published` to commenters with
 * `phase_changes`, which this function doesn't compute (comment-mode isn't
 * built yet); the dispatcher's caller documents that gap.
 */
export interface PublishNotifyRecipients {
  every_revision: string[];
  dispositions: PublishDispositionRecipient[];
  final_published: PublishFinalRecipient[];
}

export interface PublishNotifyResult {
  counts: PublishNotifyCounts;
  recipients: PublishNotifyRecipients;
}

/**
 * `specs/api/admin.md` Versions -> `POST .../versions` response:
 * `{ notified: { every_revision, dispositions, signers } }`. Computes
 * recipients from live preferences + `notified` idempotency and marks them
 * in **one** follow-up `Action: send` commit
 * (`specs/behaviors/notifications.md`: "recorded in one commit ... never
 * one commit per recipient") -- synchronously, so the idempotency mark
 * always lands even if the `notifications` plan's dispatcher (which
 * actually renders and delivers these, using `recipients` below) is slow or
 * fails outright.
 */
export async function dispatchPublishNotifications(opts: {
  fastify: FastifyInstance;
  document: string;
  version: number;
  final: boolean;
  dispositionedPersons: readonly string[];
  actor: Actor;
  requestId: string | undefined;
}): Promise<PublishNotifyResult> {
  const { fastify, document, version, final, dispositionedPersons, actor, requestId } = opts;
  const participations = fastify.storage.readModel.listParticipationsForDocument(document);

  const versionKey = `v${version}`;
  const dispositionKey = `disposition-${versionKey}`;
  const dispositionedSet = new Set(dispositionedPersons);
  const now = new Date().toISOString();

  const marks = new Map<string, Record<string, string>>();
  const everyRevisionRecipients: string[] = [];
  const dispositionRecipients: PublishDispositionRecipient[] = [];
  const finalRecipients: PublishFinalRecipient[] = [];

  for (const entry of participations) {
    if (entry.record.link_revoked) continue;
    const person = entry.record.person;
    const patch: Record<string, string> = {};

    if (prefOn(entry, "every_revision") && entry.record.notified?.[versionKey] === undefined) {
      patch[versionKey] = now;
      everyRevisionRecipients.push(person);
    }
    if (
      dispositionedSet.has(person) &&
      prefOn(entry, "my_comments_addressed") &&
      entry.record.notified?.[dispositionKey] === undefined
    ) {
      patch[dispositionKey] = now;
      dispositionRecipients.push({
        person,
        outcomes: personDispositionOutcomes(fastify, document, person, version),
      });
    }
    if (
      final &&
      isCurrentSigner(entry) &&
      entry.record.notified?.["final-published"] === undefined
    ) {
      patch["final-published"] = now;
      finalRecipients.push({ person, conditional: entry.record.signature?.conditional === true });
    }

    if (Object.keys(patch).length > 0) marks.set(person, patch);
  }

  if (marks.size > 0) {
    await fastify.storage.commit(
      "send",
      {
        actor,
        subject: `send: v${version} notifications for ${document} (${marks.size} recipients)`,
        document,
        version,
        requestId,
      },
      async (tx) => {
        for (const [person, patch] of marks) {
          const current = await tx.participations.queryFirst({ document, person });
          if (!current) continue;
          await tx.participations.patch(
            { document, person },
            { notified: { ...current.notified, ...patch } },
          );
        }
      },
    );
  }

  return {
    counts: {
      every_revision: everyRevisionRecipients.length,
      dispositions: dispositionRecipients.length,
      signers: finalRecipients.length,
    },
    recipients: {
      every_revision: everyRevisionRecipients,
      dispositions: dispositionRecipients,
      final_published: finalRecipients,
    },
  };
}

/** This one person's own comment dispositions set by this publish -- never another person's. */
function personDispositionOutcomes(
  fastify: FastifyInstance,
  document: string,
  person: string,
  version: number,
): Array<{ outcome: string; note?: string }> {
  const outcomes: Array<{ outcome: string; note?: string }> = [];
  for (const entry of fastify.storage.readModel.listSubmissionsForDocument(document)) {
    if (entry.record.person !== person) continue;
    for (const comment of entry.record.comments ?? []) {
      if (comment.disposition_version === version && comment.disposition) {
        outcomes.push({ outcome: comment.disposition, note: comment.disposition_note });
      }
    }
  }
  return outcomes;
}
