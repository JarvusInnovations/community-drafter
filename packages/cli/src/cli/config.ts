import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";

/**
 * `specs/api/admin-cli.md` § Configuration: `DRAFTER_URL` and
 * `DRAFTER_ADMIN_TOKEN` from the environment (or
 * `~/.config/drafter/<profile>.toml`); `--actor <label>` sets `X-Actor`
 * (default: `cli:<os user>`).
 */
export interface DrafterConfig {
  url: string;
  adminToken: string;
  actor: string;
}

interface TomlProfile {
  url?: string;
  admin_token?: string;
}

function configDir(): string {
  return join(homedir(), ".config", "drafter");
}

/**
 * A deliberately minimal TOML reader: flat `key = "value"` lines only — the
 * profile file never needs more than `url` and `admin_token`, so this
 * avoids taking on a TOML parsing dependency for two string fields.
 */
function parseFlatToml(text: string): TomlProfile {
  const result: TomlProfile = {};
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
    if (key === "url" || key === "admin_token") result[key] = value;
  }
  return result;
}

function readProfile(profile: string): TomlProfile {
  const path = join(configDir(), `${profile}.toml`);
  if (!existsSync(path)) return {};
  try {
    return parseFlatToml(readFileSync(path, "utf8"));
  } catch {
    // A corrupt profile file must not brick every command — env vars still work.
    return {};
  }
}

function defaultActor(): string {
  try {
    return `cli:${userInfo().username}`;
  } catch {
    return "cli";
  }
}

export interface ResolveConfigOptions {
  profile?: string;
  actor?: string;
}

export function resolveConfig(options: ResolveConfigOptions = {}): DrafterConfig {
  const profile = options.profile ?? "default";
  const fromFile = readProfile(profile);

  const url = process.env.DRAFTER_URL ?? fromFile.url;
  const adminToken = process.env.DRAFTER_ADMIN_TOKEN ?? fromFile.admin_token;

  if (!url) {
    throw new AxiError("DRAFTER_URL is not set", "USAGE", [
      `Set DRAFTER_URL in the environment, or add url = "..." to ~/.config/drafter/${profile}.toml`,
    ]);
  }
  if (!adminToken) {
    throw new AxiError("DRAFTER_ADMIN_TOKEN is not set", "USAGE", [
      `Set DRAFTER_ADMIN_TOKEN in the environment, or add admin_token = "..." to ~/.config/drafter/${profile}.toml`,
    ]);
  }

  return { url: url.replace(/\/+$/, ""), adminToken, actor: options.actor ?? defaultActor() };
}

/** Whether the environment carries enough to talk to an instance — used by the SessionStart hook. */
export function isConfigured(): boolean {
  return Boolean(process.env.DRAFTER_URL) || existsSync(join(configDir(), "default.toml"));
}
