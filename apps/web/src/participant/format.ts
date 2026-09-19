/**
 * Date/time and countdown formatting for the participant routes.
 * `specs/behaviors/document-lifecycle.md` § "The visible clock": "absolute
 * time (participant's local time zone, with zone name) and a relative
 * countdown". No date library — `Intl` covers both natively, which matters
 * for the 120 KB gzipped bundle budget (`specs/architecture.md`).
 */

const ABSOLUTE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Tue, Sep 23, 2026, 5:00 PM EDT" — the participant's local zone, zone name included. */
export function formatAbsolute(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  return ABSOLUTE_FORMAT.format(new Date(iso));
}

/** "Sep 23, 2026" — used where only the date (no time) reads better. */
export function formatDateOnly(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  return DATE_ONLY_FORMAT.format(new Date(iso));
}

export interface Countdown {
  /** "in 2 days 4 hours" / "in 45 minutes" / "in less than a minute" / "" once passed. */
  label: string;
  /** Whether this deadline is inside the live-updating 24 h window. */
  isLive: boolean;
  /** Whether `now` is already past the deadline. */
  isPast: boolean;
}

/** `specs/behaviors/document-lifecycle.md`: "Within the last 24 hours the countdown updates live." */
export const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function formatCountdown(deadlineIso: string | undefined, now: Date): Countdown {
  if (!deadlineIso) {
    return { label: "", isLive: false, isPast: false };
  }
  const deadline = new Date(deadlineIso);
  const diffMs = deadline.getTime() - now.getTime();
  const isLive = Math.abs(diffMs) <= LIVE_WINDOW_MS;
  if (diffMs <= 0) {
    return { label: "", isLive, isPast: true };
  }

  const totalMinutes = Math.round(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours > 0) {
      parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    }
  } else if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes > 0) {
      parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    }
  } else if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  } else {
    return { label: "less than a minute", isLive, isPast: false };
  }

  return { label: parts.join(" "), isLive, isPast: false };
}
