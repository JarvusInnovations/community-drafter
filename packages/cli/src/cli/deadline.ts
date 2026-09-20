import { AxiError } from "axi-sdk-js";

/**
 * `specs/api/admin-cli.md`: a deadline flag takes ISO 8601 with a zone
 * (`2026-10-01T21:00:00Z`, `2026-10-01T17:00:00-04:00`), or a zone-less
 * date-time (`2026-10-01T17:00`, `2026-10-01 17:00`) read in this machine's
 * local time zone. The API only accepts zoned input, so the CLI resolves
 * the local form here and tells the operator what it resolved to.
 */
export interface ResolvedDeadline {
  /** UTC ISO 8601, what the API receives. */
  iso: string;
  /** One line for the operator: how the input was read and the resulting instant. */
  note: string;
}

const ZONED = /(Z|[+-]\d\d:?\d\d)$/u;
const LOCAL = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/u;

function localZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  } catch {
    return "local time";
  }
}

function describe(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function parseDeadline(value: string, flag: string, usage: string): ResolvedDeadline {
  const trimmed = value.trim();
  if (ZONED.test(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      throw new AxiError(`${flag}: "${value}" is not a valid date-time`, "USAGE", [usage]);
    }
    return { iso: date.toISOString(), note: `${flag}: ${describe(date)}` };
  }
  if (LOCAL.test(trimmed)) {
    // `new Date("YYYY-MM-DDTHH:MM")` is local time per ECMAScript; the
    // space form is normalized to the same shape first.
    const date = new Date(trimmed.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) {
      throw new AxiError(`${flag}: "${value}" is not a valid date-time`, "USAGE", [usage]);
    }
    return {
      iso: date.toISOString(),
      note: `${flag}: read as ${localZoneName()} → ${describe(date)} (${date.toISOString()})`,
    };
  }
  throw new AxiError(
    `${flag}: "${value}" is not a date-time. Use 2026-10-01T17:00 (your local time), 2026-10-01T17:00:00-04:00, or 2026-10-01T21:00:00Z.`,
    "USAGE",
    [usage],
  );
}
