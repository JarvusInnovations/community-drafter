import type { Phase } from "../phase/phase.ts";

/**
 * `specs/behaviors/notifications.md` § Content rules: deadlines "in the
 * recipient's time zone when known (else the document's)." `people` has no
 * per-person timezone field (`specs/data-model.md`), so "the recipient's
 * time zone" is never known in phase 1 — every message falls back to
 * `INSTANCE_TIMEZONE`, which is the documented simplification this plan
 * makes explicit rather than silently.
 *
 * § "Shape": "Thu, Sep 24 · 5:00 PM EDT", the zone's name, the year only
 * when it is not the current year.
 */
function formatter(timezone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", { timeZone: safeZone(timezone), ...options });
}

function yearIn(date: Date, timezone: string): string {
  return formatter(timezone, { year: "numeric" }).format(date);
}

/** "Thu, Sep 24 · 5:00 PM EDT" (with the year appended to the date outside the current year). */
export function formatWhen(
  iso: string | undefined,
  timezone: string,
  now: Date = new Date(),
): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const sameYear = yearIn(date, timezone) === yearIn(now, timezone);
  const day = formatter(timezone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
  const time = formatter(timezone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return `${day} · ${time}`;
}

/** @deprecated kept for callers outside the templates; new code uses `formatWhen`. */
export function formatDeadline(iso: string | undefined, timezone: string): string | undefined {
  return formatWhen(iso, timezone);
}

/**
 * The clock as one sentence (`specs/behaviors/notifications.md` § "Shape"):
 * commenting → both deadlines; signing → the signing deadline; closed → when
 * the list closed; otherwise nothing.
 */
export function clockLine(
  phase: Phase,
  commentsCloseAt: string | undefined,
  signingClosesAt: string | undefined,
  timezone: string,
  now: Date = new Date(),
): string | undefined {
  const comments = formatWhen(commentsCloseAt, timezone, now);
  const signing = formatWhen(signingClosesAt, timezone, now);
  switch (phase) {
    case "commenting":
      if (comments && signing) {
        return `Comments close ${comments}, and signatures are due ${signing}.`;
      }
      return comments ? `Comments close ${comments}.` : undefined;
    case "signing":
      return signing ? `Signatures are due ${signing}.` : undefined;
    case "closed":
      return signing ? `The signatory list closed ${signing}.` : undefined;
    default:
      return undefined;
  }
}

/** The calendar date (`YYYY-MM-DD`) `at` falls on in `timezone` — the digest's dedupe key. */
export function dateInTimezone(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(timezone) }).format(at);
}

/** The current hour (0-23) in `timezone`, for the digest scheduler's "is it time yet" check. */
export function hourInTimezone(at: Date, timezone: string): number {
  const parts = formatter(timezone, { hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value;
  return hour ? Number(hour) : at.getUTCHours();
}

/** An invalid or unset IANA zone name falls back to UTC rather than throwing. */
function safeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}
