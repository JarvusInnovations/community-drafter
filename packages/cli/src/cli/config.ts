import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";

/**
 * `specs/api/admin-cli.md` § Configuration: the instance URL and the
 * credential live in `~/.config/drafter/<profile>.toml` (mode 600), written
 * by `login`. `DRAFTER_URL`/`DRAFTER_TOKEN` in the environment override the
 * profile independently (for CI and bots); `--profile <name>` selects a
 * profile (default `default`). There is no actor label any more — every
 * write is attributed to the signed-in operator.
 */
export interface StoredProfile {
  url?: string;
  email?: string;
  token?: string;
  expires_at?: string;
}

const STRING_KEYS = ["url", "email", "token", "expires_at"] as const;
type StringKey = (typeof STRING_KEYS)[number];

/**
 * `$HOME` is checked explicitly before `os.homedir()` — Node's own
 * `homedir()` already prefers `$HOME` on POSIX, but Bun's does not (it
 * reads the OS user database directly, ignoring a runtime-mutated
 * `process.env.HOME`). Checking it here keeps the two runtimes consistent
 * and lets tests sandbox the profile directory by setting `$HOME` alone.
 */
function configDir(): string {
  return join(process.env.HOME || homedir(), ".config", "drafter");
}

function profilePath(profile: string): string {
  return join(configDir(), `${profile}.toml`);
}

/**
 * A deliberately minimal TOML reader/writer: flat `key = "value"` lines
 * only — the profile file never needs more than these four string fields,
 * so this avoids taking on a TOML parsing dependency.
 */
function parseFlatToml(text: string): StoredProfile {
  const result: StoredProfile = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if ((STRING_KEYS as readonly string[]).includes(key)) {
      (result as Record<StringKey, string>)[key as StringKey] = value;
    }
  }
  return result;
}

export function readProfile(profile: string): StoredProfile {
  const path = profilePath(profile);
  if (!existsSync(path)) return {};
  try {
    return parseFlatToml(readFileSync(path, "utf8"));
  } catch {
    // A corrupt profile file must not brick every command — env vars still work.
    return {};
  }
}

function tomlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Replaces the whole profile file (mode 600) with exactly the given fields. */
export function writeProfile(profile: string, data: StoredProfile): void {
  mkdirSync(configDir(), { recursive: true });
  const lines: string[] = [];
  for (const key of STRING_KEYS) {
    const value = data[key];
    if (value !== undefined) lines.push(`${key} = ${tomlQuote(value)}`);
  }
  const path = profilePath(profile);
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  // Belt-and-suspenders: writeFileSync only applies `mode` when *creating*
  // the file, so an existing, more permissive file must be chmod'd explicitly.
  chmodSync(path, 0o600);
}

/** `logout`: "forget the token" — clears the credential but keeps `url`/`email` for a faster re-login. */
export function clearProfileToken(profile: string): boolean {
  const existing = readProfile(profile);
  if (existing.token === undefined && existing.expires_at === undefined) return false;
  writeProfile(profile, { url: existing.url, email: existing.email });
  return true;
}

export interface DrafterConfig {
  url: string;
  token: string;
  profile: string;
  /** Whether `token` came from `DRAFTER_TOKEN` (never persisted back) or the profile file (refreshed in place). */
  tokenSource: "env" | "profile";
}

export interface ResolveConfigOptions {
  profile?: string;
}

const LOGIN_HINT = "Run `drafter-axi login <email> --url <instance>` to sign in";

/**
 * `specs/api/admin-cli.md`: the profile is selected by `--profile <name>`,
 * else `DRAFTER_PROFILE`, else `default` — so a bot exports
 * `DRAFTER_PROFILE=<bot>` once and never touches the human's default profile.
 */
export function resolveProfileName(flagValue?: string): string {
  const fromEnv = process.env.DRAFTER_PROFILE?.trim();
  return flagValue ?? (fromEnv && fromEnv.length > 0 ? fromEnv : "default");
}

/** Used by every command except `login` itself. */
export function resolveConfig(options: ResolveConfigOptions = {}): DrafterConfig {
  const profile = resolveProfileName(options.profile);
  const stored = readProfile(profile);

  const url = process.env.DRAFTER_URL ?? stored.url;
  if (!url) {
    throw new AxiError("Not signed in: no instance URL is configured", "USAGE", [LOGIN_HINT]);
  }

  const envToken = process.env.DRAFTER_TOKEN;
  const token = envToken ?? stored.token;
  if (!token) {
    throw new AxiError("Not signed in: no token is configured", "USAGE", [LOGIN_HINT]);
  }

  return {
    url: url.replace(/\/+$/, ""),
    token,
    profile,
    tokenSource: envToken ? "env" : "profile",
  };
}

/** `login <email> [--url <instance>]`: resolves the instance from `--url`, else `DRAFTER_URL`, else fails. */
export function resolveLoginUrl(flagUrl: string | undefined): string {
  const url = flagUrl ?? process.env.DRAFTER_URL;
  if (!url) {
    throw new AxiError("An instance URL is required", "USAGE", [
      "Pass --url <instance>, or set DRAFTER_URL in the environment",
    ]);
  }
  return url.replace(/\/+$/, "");
}

/** Whether the environment carries enough to talk to an instance — used by the SessionStart hook and the home view. */
export function isConfigured(): boolean {
  if (process.env.DRAFTER_URL && process.env.DRAFTER_TOKEN) return true;
  const stored = readProfile("default");
  return Boolean(stored.url && stored.token);
}
