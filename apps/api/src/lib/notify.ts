import type { FastifyInstance } from "fastify";

import type { ParticipationEntry } from "../storage/read-model.ts";

/**
 * `specs/behaviors/notifications.md` § Defaults: the only two preferences.
 * `every_revision`, `daily_digest` and `phase_changes` may still sit on
 * records written by earlier builds; nothing reads them.
 */
export type NotifyPrefKey = "my_comments_addressed" | "reminders";

export const NOTIFY_PREF_KEYS: readonly NotifyPrefKey[] = ["my_comments_addressed", "reminders"];

const DEFAULT_ON: Record<NotifyPrefKey, boolean> = {
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

/** This one person's own comment dispositions set by this publish -- never another person's. */
export function personDispositionOutcomes(
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
