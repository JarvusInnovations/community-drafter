import type { ParticipationEntry } from "../storage/read-model.ts";
import { prefOn } from "./notify.ts";

/**
 * `specs/api/participant.md` § prefs: the `notify` table — `channel`,
 * `my_comments_addressed`, `reminders` — plus the masked email. There are
 * no forced keys: every message a preference could have forced on is
 * either a receipt or an operator's deliberate send
 * (`specs/behaviors/notifications.md` § Defaults).
 */
export interface PrefsView {
  channel: string;
  my_comments_addressed: boolean;
  reminders: boolean;
  /** `specs/screens/preferences.md` § Data Requirements: "email shown masked, e.g. `j***@example.org`." */
  email_masked?: string;
}

/** `j***@example.org` — the local part's first character, the rest starred, domain untouched. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export function buildPrefsView(entry: ParticipationEntry, email?: string): PrefsView {
  return {
    channel: entry.record.notify?.channel ?? "email",
    my_comments_addressed: prefOn(entry, "my_comments_addressed"),
    reminders: prefOn(entry, "reminders"),
    email_masked: email ? maskEmail(email) : undefined,
  };
}
