/**
 * Date/time and countdown formatting for the participant routes.
 * `specs/behaviors/document-lifecycle.md` § "The visible clock": "absolute
 * time (participant's local time zone, with zone name) and a relative
 * countdown". `specs/screens/document.md` § Design "Dates": "Thu, Sep 24 ·
 * 5:00 PM EDT", the year only when it is not the current year, date-only
 * points as "Sep 24". No date library — `Intl` covers both natively, which
 * matters for the 120 KB gzipped bundle budget (`specs/architecture.md`).
 */

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const DAY_WITH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const DATE_ONLY_WITH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function isCurrentYear(date: Date): boolean {
  return date.getFullYear() === new Date().getFullYear();
}

/** "Thu, Sep 24 · 5:00 PM EDT" — the participant's local zone, zone name included; the year only when it differs from this year. */
export function formatAbsolute(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  const day = (isCurrentYear(date) ? DAY_FORMAT : DAY_WITH_YEAR_FORMAT).format(date);
  return `${day} · ${TIME_FORMAT.format(date)}`;
}

/** "Sep 24" (or "Sep 24, 2027" outside the current year) — used where only the date reads better. */
export function formatDateOnly(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  return (isCurrentYear(date) ? DATE_ONLY_FORMAT : DATE_ONLY_WITH_YEAR_FORMAT).format(date);
}

/**
 * "Sep 21" from a calendar day (`YYYY-MM-DD`) rather than an instant. A day
 * stamp has no time and no zone — parsing it as an instant would show the
 * day before for every reader west of UTC — so it is built as a local date
 * and formatted in place.
 */
export function formatDayStamp(day: string | undefined): string {
  if (!day) {
    return "";
  }
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return day;
  }
  const parsed = new Date(year, month - 1, date);
  return (isCurrentYear(parsed) ? DATE_ONLY_FORMAT : DATE_ONLY_WITH_YEAR_FORMAT).format(parsed);
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
