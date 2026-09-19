/**
 * `specs/behaviors/notifications.md` § Content rules: "states ... its next
 * deadline in the recipient's time zone when known (else the document's)."
 * `people` has no per-person timezone field (`specs/data-model.md`), so
 * "the recipient's time zone" is never known in phase 1 — every message
 * falls back to `INSTANCE_TIMEZONE`, which is the documented simplification
 * this plan makes explicit rather than silently.
 */
export function formatDeadline(iso: string | undefined, timezone: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    // An invalid/unset IANA zone name falls back to UTC rather than throwing.
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}

/** The calendar date (`YYYY-MM-DD`) `at` falls on in `timezone` — the digest's dedupe key. */
export function dateInTimezone(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(at);
  }
}

/** The current hour (0-23) in `timezone`, for the digest scheduler's "is it time yet" check. */
export function hourInTimezone(at: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(at);
    const hour = parts.find((p) => p.type === "hour")?.value;
    return hour ? Number(hour) : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}
