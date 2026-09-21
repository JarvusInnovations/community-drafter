import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isConfigured,
  resetLegacyProfileNotice,
  resolveConfig,
  resolveProfileName,
  writeProfile,
} from "./config.js";

const original = process.env.SIGNATORIES_PROFILE;
afterEach(() => {
  if (original === undefined) delete process.env.SIGNATORIES_PROFILE;
  else process.env.SIGNATORIES_PROFILE = original;
});

/** `specs/api/admin-cli.md`: `--profile`, else `SIGNATORIES_PROFILE`, else `default`. */
describe("resolveProfileName", () => {
  it("defaults to `default` with nothing set", () => {
    delete process.env.SIGNATORIES_PROFILE;
    expect(resolveProfileName(undefined)).toBe("default");
  });

  it("uses SIGNATORIES_PROFILE when no flag is given, ignoring blank values", () => {
    process.env.SIGNATORIES_PROFILE = "stac-bot";
    expect(resolveProfileName(undefined)).toBe("stac-bot");
    process.env.SIGNATORIES_PROFILE = "   ";
    expect(resolveProfileName(undefined)).toBe("default");
  });

  it("lets --profile override the environment", () => {
    process.env.SIGNATORIES_PROFILE = "stac-bot";
    expect(resolveProfileName("work")).toBe("work");
  });
});

/**
 * `specs/api/admin-cli.md` § Configuration, "Reading the old location": the
 * profile directory and the environment variables both moved, and both keep
 * honouring the `drafter` spellings the tool shipped under before the rename.
 * Every case here sandboxes `$HOME` — no test ever reads a real config dir.
 */
describe("compatibility with the drafter-era configuration", () => {
  const home = mkdtempSync(join(tmpdir(), "signatories-config-"));
  const saved = { ...process.env };

  function writeToml(dir: string, profile: string, url: string, token: string): void {
    const target = join(home, ".config", dir);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, `${profile}.toml`), `url = "${url}"\ntoken = "${token}"\n`);
  }

  beforeEach(() => {
    rmSync(join(home, ".config"), { recursive: true, force: true });
    for (const key of [
      "SIGNATORIES_URL",
      "SIGNATORIES_TOKEN",
      "SIGNATORIES_PROFILE",
      "DRAFTER_URL",
      "DRAFTER_TOKEN",
      "DRAFTER_PROFILE",
    ]) {
      delete process.env[key];
    }
    process.env.HOME = home;
    resetLegacyProfileNotice();
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("prefers a profile in ~/.config/signatories", () => {
    writeToml("signatories", "default", "https://new.example.org", "new-token");
    writeToml("drafter", "default", "https://old.example.org", "old-token");
    expect(resolveConfig().url).toBe("https://new.example.org");
  });

  it("falls back to ~/.config/drafter, and says so once on stderr", () => {
    writeToml("drafter", "default", "https://old.example.org", "old-token");

    const notices: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      notices.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(resolveConfig().url).toBe("https://old.example.org");
      expect(resolveConfig().token).toBe("old-token");
    } finally {
      process.stderr.write = write;
    }

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(join(home, ".config", "drafter", "default.toml"));
    expect(notices[0]).toContain(join(home, ".config", "signatories"));
  });

  it("writes a new profile to ~/.config/signatories, never back to the old directory", () => {
    writeProfile("default", { url: "https://new.example.org", token: "t" });
    expect(existsSync(join(home, ".config", "signatories", "default.toml"))).toBe(true);
    expect(existsSync(join(home, ".config", "drafter"))).toBe(false);
  });

  it("honours DRAFTER_URL and DRAFTER_TOKEN when the new names are unset", () => {
    process.env.DRAFTER_URL = "https://ci.example.org/";
    process.env.DRAFTER_TOKEN = "ci-token";
    const config = resolveConfig();
    expect(config.url).toBe("https://ci.example.org");
    expect(config.token).toBe("ci-token");
    expect(config.tokenSource).toBe("env");
    expect(isConfigured()).toBe(true);
  });

  it("lets the new names win over the old ones", () => {
    process.env.DRAFTER_URL = "https://old.example.org";
    process.env.DRAFTER_TOKEN = "old-token";
    process.env.DRAFTER_PROFILE = "old-bot";
    process.env.SIGNATORIES_URL = "https://new.example.org";
    process.env.SIGNATORIES_TOKEN = "new-token";
    process.env.SIGNATORIES_PROFILE = "new-bot";

    const config = resolveConfig();
    expect(config.url).toBe("https://new.example.org");
    expect(config.token).toBe("new-token");
    expect(resolveProfileName(undefined)).toBe("new-bot");
  });

  it("selects the profile from DRAFTER_PROFILE when SIGNATORIES_PROFILE is unset", () => {
    process.env.DRAFTER_PROFILE = "old-bot";
    expect(resolveProfileName(undefined)).toBe("old-bot");
  });
});
