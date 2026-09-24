import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";

/**
 * `specs/api/admin-cli.md` § Configuration: the instance URL and the
 * credential live in `~/.config/signatories/<profile>.toml` (mode 600), written
 * by `login`. `SIGNATORIES_URL`/`SIGNATORIES_TOKEN` in the environment override the
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
function homeDir(): string {
  return process.env.HOME || homedir();
}

function configDir(): string {
  return join(homeDir(), ".config", "signatories");
}

/**
 * `specs/api/admin-cli.md` § Configuration, "Reading the old location": the
 * tool used to be `drafter-axi` and wrote `~/.config/drafter/`. Writes never
 * come back here — a read falls back to it only when the new directory has
 * nothing for the selected profile.
 */
function legacyConfigDir(): string {
  return join(homeDir(), ".config", "drafter");
}

function profilePath(profile: string): string {
  return join(configDir(), `${profile}.toml`);
}

/**
 * The notice is said once per process and on **stderr**, so it can never
 * contaminate the TOON or JSON a caller is parsing on stdout.
 */
let legacyNoticeSaid = false;

/** Test seam: one process runs many cases, and the notice is one-shot. */
export function resetLegacyProfileNotice(): void {
  legacyNoticeSaid = false;
}

/**
 * The environment variable for `name`, new spelling first. The `DRAFTER_*`
 * spellings stay honoured for a CI job or bot that exported them, but
 * nothing the CLI prints ever names them: they are a compatibility surface,
 * not part of the contract.
 */
function envValue(name: "URL" | "TOKEN" | "PROFILE"): string | undefined {
  return process.env[`SIGNATORIES_${name}`] ?? process.env[`DRAFTER_${name}`];
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
  let path = profilePath(profile);
  let fromLegacy = false;

  if (!existsSync(path)) {
    const legacy = join(legacyConfigDir(), `${profile}.toml`);
    if (!existsSync(legacy)) return {};
    path = legacy;
    fromLegacy = true;
  }

  try {
    const parsed = parseFlatToml(readFileSync(path, "utf8"));
    if (fromLegacy && !legacyNoticeSaid) {
      legacyNoticeSaid = true;
      process.stderr.write(
        `note: read the profile from ${path}; the next \`login\` writes to ${configDir()}\n`,
      );
    }
    return parsed;
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

export interface SignatoriesConfig {
  url: string;
  token: string;
  profile: string;
  /** Whether `token` came from `SIGNATORIES_TOKEN` (never persisted back) or the profile file (refreshed in place). */
  tokenSource: "env" | "profile";
}

export interface ResolveConfigOptions {
  profile?: string;
}

const LOGIN_HINT = "Run `signatories-axi login <email> --url <instance>` to sign in";

/**
 * `specs/api/admin-cli.md`: the profile is selected by `--profile <name>`,
 * else `SIGNATORIES_PROFILE`, else `default` — so a bot exports
 * `SIGNATORIES_PROFILE=<bot>` once and never touches the human's default profile.
 */
export function resolveProfileName(flagValue?: string): string {
  const fromEnv = envValue("PROFILE")?.trim();
  return flagValue ?? (fromEnv && fromEnv.length > 0 ? fromEnv : "default");
}

/** Used by every command except `login` itself. */
export function resolveConfig(options: ResolveConfigOptions = {}): SignatoriesConfig {
  const profile = resolveProfileName(options.profile);
  const stored = readProfile(profile);

  const url = envValue("URL") ?? stored.url;
  if (!url) {
    throw new AxiError("Not signed in: no instance URL is configured", "USAGE", [LOGIN_HINT]);
  }

  const envToken = envValue("TOKEN");
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

/** `login <email> [--url <instance>]`: resolves the instance from `--url`, else `SIGNATORIES_URL`, else fails. */
export function resolveLoginUrl(flagUrl: string | undefined): string {
  const url = flagUrl ?? envValue("URL");
  if (!url) {
    throw new AxiError("An instance URL is required", "USAGE", [
      "Pass --url <instance>, or set SIGNATORIES_URL in the environment",
    ]);
  }
  return url.replace(/\/+$/, "");
}

/** Whether the environment carries enough to talk to an instance — used by the SessionStart hook and the home view. */
/** Whether a session exists for the selected profile (`--profile`, `SIGNATORIES_PROFILE`, else `default`) or the env pair. */
export function isConfigured(options: ResolveConfigOptions = {}): boolean {
  if (envValue("URL") && envValue("TOKEN")) return true;
  const stored = readProfile(resolveProfileName(options.profile));
  return Boolean(stored.url && stored.token);
}
