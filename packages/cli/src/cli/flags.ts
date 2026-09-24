import { AxiError } from "axi-sdk-js";

/**
 * Per-command flag declaration and a fail-loud argv parser
 * (`axi` skill §6 "Fail loud on unrecognized input"). Ported from the
 * pattern proven in sibling `*-axi` tools.
 */
export interface FlagSpec {
  /** How many positional arguments this command accepts (undefined = unlimited). */
  positionals?: number;
  /** Flags that take a value, e.g. `--summary "..."`. */
  value?: string[];
  /**
   * Value flags that may be repeated, accumulating into a list —
   * `--addressed-to "A" --addressed-to "B"`. Repeatable rather than
   * comma-separated because the values are proper names ("Board of
   * Education, District 5") and a comma in one of them would silently
   * split it in two.
   */
  multi?: string[];
  /** Flags that are standalone switches, e.g. `--dry-run`. */
  boolean?: string[];
  /** Renamed or removed flags mapped to a targeted hint. */
  deprecated?: Record<string, string>;
}

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
  /** Values of repeatable flags, in the order they were given. */
  lists: Record<string, string[]>;
}

/** `--help` is universal and never reported as unknown (AXI §6). */
const ALWAYS_ALLOWED = new Set(["--help", "-h"]);

/**
 * Global flags accepted on every command without per-command declaration:
 * `--json` switches to raw JSON output, `--profile` selects a
 * `~/.config/signatories/<profile>.toml` block. Never reported as unknown.
 * There is no actor label (`specs/api/admin-cli.md` § Configuration:
 * "every write is attributed to the signed-in operator") — no `--actor`.
 */
const GLOBAL_VALUE_FLAGS = new Set(["--profile"]);
const GLOBAL_BOOLEAN_FLAGS = new Set(["--json"]);

function isValueLike(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  if (!arg.startsWith("-")) return true;
  // A negative number (or an ISO offset like -05:00) is a value, not a flag.
  return /^-[.\d]/.test(arg);
}

/**
 * Parse argv for one command, rejecting anything not declared. A
 * silently-dropped flag is worse than an error: the agent would believe its
 * request was scoped/filtered and act on wrong data. Unrecognized flags
 * fail with exit code 2 and list the valid flags inline.
 */
export function parseFlags(command: string, argv: string[], spec: FlagSpec): Parsed {
  const multiFlags = new Set(spec.multi ?? []);
  const valueFlags = new Set([...(spec.value ?? []), ...multiFlags]);
  const boolFlags = new Set(spec.boolean ?? []);
  const deprecated = spec.deprecated ?? {};
  const known = [...valueFlags, ...boolFlags].sort();

  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const lists: Record<string, string[]> = {};
  const take = (name: string, value: string): void => {
    if (multiFlags.has(name)) (lists[name] ??= []).push(value);
    else flags[name] = value;
  };

  const unknown = (name: string): never => {
    const hint = deprecated[name];
    throw new AxiError(`unknown flag ${name} for \`${command}\``, "UNKNOWN_FLAG", [
      ...(hint ? [hint] : []),
      known.length > 0
        ? `valid flags for \`${command}\`: ${known.join(", ")} (--help, --json, --profile always allowed)`
        : `\`${command}\` takes no flags of its own (--help, --json, --profile always allowed)`,
    ]);
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    if (ALWAYS_ALLOWED.has(arg)) {
      flags["--help"] = true;
      continue;
    }

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);

    if (boolFlags.has(name) || GLOBAL_BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        throw new AxiError(`${name} is a switch and takes no value`, "USAGE", [
          `Run \`signatories-axi ${command} ${name}\` without a value`,
        ]);
      }
      flags[name] = true;
      continue;
    }

    if (valueFlags.has(name) || GLOBAL_VALUE_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        take(name, inlineValue);
        continue;
      }
      const next = argv[i + 1];
      if (!isValueLike(next)) {
        throw new AxiError(`${name} requires a value`, "USAGE", [
          `Run \`signatories-axi ${command} ${name} <value>\``,
        ]);
      }
      take(name, next!);
      i++;
      continue;
    }

    unknown(name);
  }

  const allowed = spec.positionals;
  if (allowed !== undefined && positional.length > allowed) {
    throw new AxiError(
      allowed === 0
        ? `\`${command}\` takes no positional arguments, but got "${positional[0]}"`
        : `\`${command}\` takes at most ${allowed} positional argument${allowed === 1 ? "" : "s"}, but got ${positional.length}`,
      "USAGE",
      [`Run \`signatories-axi ${command} --help\` for the expected form`],
    );
  }

  return { positional, flags, lists };
}

/** Read a value flag as a string, or fall back to a default. */
export function str(parsed: Parsed, name: string, fallback: string): string;
export function str(parsed: Parsed, name: string): string | undefined;
export function str(parsed: Parsed, name: string, fallback?: string): string | undefined {
  const raw = parsed.flags[name];
  return typeof raw === "string" ? raw : fallback;
}

/** True when a boolean (or present value) flag was supplied. */
export function bool(parsed: Parsed, name: string): boolean {
  return parsed.flags[name] !== undefined;
}

/**
 * Every value given for a repeatable flag, trimmed and non-empty.
 * `undefined` when the flag was not given at all, which a caller needs to
 * distinguish from an explicit empty list.
 */
export function list(parsed: Parsed, name: string): string[] | undefined {
  const raw = parsed.lists[name];
  if (raw === undefined) return undefined;
  return raw.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Split a comma-separated flag value into a trimmed, non-empty list. */
export function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Require the Nth positional argument, or fail with usage. */
export function requirePositional(
  parsed: Parsed,
  index: number,
  label: string,
  usage: string,
): string {
  const value = parsed.positional[index];
  if (value === undefined || value.length === 0) {
    throw new AxiError(`${label} is required`, "USAGE", [usage]);
  }
  return value;
}

/** Require a value flag, or fail with usage. */
export function requireStr(parsed: Parsed, name: string, usage: string): string {
  const value = str(parsed, name);
  if (value === undefined || value.length === 0) {
    throw new AxiError(`${name} is required`, "USAGE", [usage]);
  }
  return value;
}

/**
 * Resolve a noun's subcommand (`docs create`, `people list`, ...) and parse
 * the remaining argv against that subcommand's own declared flag set.
 */
export function parseSubcommand(
  command: string,
  args: string[],
  specs: Record<string, FlagSpec>,
): { sub: string; parsed: Parsed } {
  const first = args[0];

  if (first === undefined || !(first in specs)) {
    throw new AxiError(
      first === undefined
        ? `\`${command}\` requires a subcommand`
        : `unknown ${command} subcommand "${first}"`,
      "VALIDATION_ERROR",
      [`valid subcommands: ${Object.keys(specs).join(", ")}`],
    );
  }

  const parsed = parseFlags(`${command} ${first}`, args.slice(1), specs[first]!);
  return { sub: first, parsed };
}
