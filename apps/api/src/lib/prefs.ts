import type { ParticipationEntry } from "../storage/read-model.ts";
import { isCurrentSigner, prefOn } from "./notify.ts";

export interface PrefsView {
  channel: string;
  every_revision: boolean;
  daily_digest: boolean;
  phase_changes: boolean;
  my_comments_addressed: boolean;
  reminders: boolean;
  forced: string[];
}

/**
 * `specs/behaviors/notifications.md` § Messages: `signing-opened`,
 * `final-published` and `closing-soon` are "forced on" for current
 * signers, and all three ride on the `phase_changes` toggle for anyone
 * else. There is no dedicated toggle for those three events in
 * `NotifyPrefsSchema`, so a current signer's `phase_changes` key is the one
 * this plan reports as forced — `plans/api-core.md` doesn't spell out the
 * mapping; this is the reading that matches "the preference toggle is
 * shown disabled" (one toggle, not three).
 */
export function forcedKeys(entry: ParticipationEntry): string[] {
  return isCurrentSigner(entry) ? ["phase_changes"] : [];
}

export function buildPrefsView(entry: ParticipationEntry): PrefsView {
  return {
    channel: entry.record.notify?.channel ?? "email",
    every_revision: prefOn(entry, "every_revision"),
    daily_digest: prefOn(entry, "daily_digest"),
    phase_changes: prefOn(entry, "phase_changes"),
    my_comments_addressed: prefOn(entry, "my_comments_addressed"),
    reminders: prefOn(entry, "reminders"),
    forced: forcedKeys(entry),
  };
}
