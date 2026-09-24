import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AxiError, computeSessionStartHookUpdate, type HookSettings } from "axi-sdk-js";

import { parseFlags, str, type FlagSpec } from "../flags.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output.js";

/**
 * `specs/api/admin-cli.md` § Session hook: "the skill ships a SessionStart
 * hook that prints the home view when `SIGNATORIES_URL` is set." Managed
 * explicitly (not via the SDK's auto-install, which is a no-op for a
 * `.mjs`-named bundle) so it can target **project** scope — the vendored
 * skill in the adopting team's own repo — by default, with **global**
 * available for a single operator's every-session use.
 */
const HOOK_FLAGS: Record<string, FlagSpec> = {
  install: { positionals: 0, value: ["--scope", "--dir"] },
  uninstall: { positionals: 0, value: ["--scope"] },
  status: { positionals: 0 },
};

export const HOOK_HELP = `usage: signatories-axi hook <install|uninstall> [--scope project|global] [--dir <path>]
       signatories-axi hook status

Manage the SessionStart hook that prints the home view (open documents, phase,
next deadline, funnel counts) at the start of every agent session, when
SIGNATORIES_URL is set (silent otherwise — a fresh clone without a configured
instance stays quiet).

Default scope is project: written to <repo>/.claude/settings.json (so it is
committed and portable for every contributor). --dir sets the repo root
(default: the git repo root of the current directory). --scope global installs
to ~/.claude/settings.json for every session on this machine instead.`;

const MARKER = "signatories-axi";
/** The name this tool shipped under before the rename; hooks written then still match. */
const LEGACY_MARKER = "drafter-axi";
const TIMEOUT_SECONDS = 10;

type Scope = "project" | "global";

function gitRoot(): string | undefined {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root || undefined;
  } catch {
    return undefined;
  }
}

function projectBase(dirFlag: string | undefined): string {
  if (dirFlag) return resolve(dirFlag);
  const root = gitRoot();
  if (root) return root;
  throw new AxiError(
    "couldn't determine the project directory (current directory is not a git repository)",
    "USAGE",
    ["Pass --dir <project-path>, or run from inside the target repo"],
  );
}

function resolveScope(scopeFlag: string | undefined): Scope {
  if (scopeFlag === undefined) return "project";
  if (scopeFlag !== "project" && scopeFlag !== "global") {
    throw new AxiError("--scope must be project or global", "USAGE", [
      "signatories-axi hook install                 (project — the default)",
      "signatories-axi hook install --scope global",
    ]);
  }
  return scopeFlag;
}

function settingsPath(scope: Scope, dirFlag: string | undefined): string {
  const base = scope === "global" ? homedir() : projectBase(dirFlag);
  return join(base, ".claude", "settings.json");
}

/** Absolute path to the bundle's sibling `signatories-axi` shim on this machine. */
function shimPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "signatories-axi");
}

/**
 * Project scope must be portable across contributors and machines: the
 * hook is written to `<repo>/.claude/settings.json` and committed, so it
 * runs `${CLAUDE_PROJECT_DIR}`-relative to the vendored skill's shim (the
 * `.claude/skills/signatories-axi` symlink the `npx skills add` install
 * creates), never a machine-specific absolute path. Global scope is
 * per-machine and never committed, so the absolute shim path is correct
 * there — it self-locates wherever the global skill lives.
 *
 * Both run the explicit `home --if-configured` form (not the bare
 * zero-arg invocation) so the hook can stay silent when SIGNATORIES_URL isn't
 * set — the SDK rejects a leading flag before a command, so the zero-arg
 * form cannot itself take that flag.
 */
const PROJECT_HOOK_COMMAND =
  '"${CLAUDE_PROJECT_DIR}/.claude/skills/signatories-axi/scripts/signatories-axi" home --if-configured';

function hookCommand(scope: Scope): string {
  return scope === "global"
    ? `${JSON.stringify(shimPath())} home --if-configured`
    : PROJECT_HOOK_COMMAND;
}

function readSettings(path: string): HookSettings {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new AxiError(`could not parse ${path}`, "USAGE", [
      "Fix or remove the malformed JSON file",
    ]);
  }
}

function writeSettings(path: string, settings: HookSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function isManaged(command: unknown): boolean {
  return (
    typeof command === "string" && (command.includes(MARKER) || command.includes(LEGACY_MARKER))
  );
}

function managedCommand(settings: HookSettings): string | undefined {
  const groups = settings.hooks?.SessionStart;
  if (!Array.isArray(groups)) return undefined;
  for (const group of groups) {
    for (const hook of group.hooks ?? []) {
      if (isManaged(hook.command)) return hook.command;
    }
  }
  return undefined;
}

/** Drops the hooks `matches` selects. Returns how many went. */
function stripHooks(settings: HookSettings, matches: (command: unknown) => boolean): number {
  const groups = settings.hooks?.SessionStart;
  if (!Array.isArray(groups)) return 0;
  let removed = 0;
  for (const group of groups) {
    const before = group.hooks?.length ?? 0;
    if (group.hooks) group.hooks = group.hooks.filter((h) => !matches(h.command));
    removed += before - (group.hooks?.length ?? 0);
  }
  settings.hooks!.SessionStart = groups.filter((g) => (g.hooks?.length ?? 0) > 0);
  return removed;
}

const isLegacy = (command: unknown): boolean =>
  typeof command === "string" && command.includes(LEGACY_MARKER);

function install(args: string[]): string {
  const parsed = parseFlags("hook install", args, HOOK_FLAGS.install!);
  const scope = resolveScope(str(parsed, "--scope"));
  const path = settingsPath(scope, str(parsed, "--dir"));
  const command = hookCommand(scope);

  const settings = readSettings(path);
  // A hook left over from when this tool was `drafter-axi` points at a skill
  // directory that no longer exists, so installing replaces it rather than
  // running alongside it.
  const legacyRemoved = stripHooks(settings, isLegacy) > 0;
  const [updated, changed] = computeSessionStartHookUpdate(settings, {
    marker: MARKER,
    command,
    timeoutSeconds: TIMEOUT_SECONDS,
  });

  if (changed || legacyRemoved) writeSettings(path, updated);
  return joinBlocks(
    renderObject({
      hook: changed ? "installed" : legacyRemoved ? "replaced" : "already up to date",
      scope,
      file: path,
      runs: command,
    }),
    renderHelp([
      "Every session in this scope opens with the documents dashboard (when SIGNATORIES_URL is set)",
      `Run \`signatories-axi hook uninstall --scope ${scope}\` to remove it`,
    ]),
  );
}

function uninstall(args: string[]): string {
  const parsed = parseFlags("hook uninstall", args, HOOK_FLAGS.uninstall!);
  const scope = resolveScope(str(parsed, "--scope"));
  const path = settingsPath(scope, undefined);

  if (!existsSync(path)) {
    return renderObject({ hook: "not installed (no-op)", scope, file: path });
  }

  const settings = readSettings(path);
  const removed = stripHooks(settings, isManaged);

  if (removed > 0) writeSettings(path, settings);
  return renderObject({
    hook: removed > 0 ? "removed" : "not installed (no-op)",
    scope,
    file: path,
  });
}

function status(): string {
  const describe = (path: string) => {
    const command = existsSync(path) ? managedCommand(readSettings(path)) : undefined;
    return command ? { installed: true, runs: command } : { installed: false };
  };

  const globalPath = join(homedir(), ".claude", "settings.json");
  const rows: Array<Record<string, unknown>> = [
    { scope: "global", file: globalPath, ...describe(globalPath) },
  ];

  const root = gitRoot();
  if (root) {
    const projectPath = join(root, ".claude", "settings.json");
    rows.push({ scope: "project", file: projectPath, ...describe(projectPath) });
  } else {
    rows.push({
      scope: "project",
      file: "(cwd is not a git repo — pass --dir to `hook install`)",
      installed: "n/a",
    });
  }

  return joinBlocks(
    renderList("hooks", rows, [
      { name: "scope", extract: (r) => r.scope },
      { name: "installed", extract: (r) => r.installed },
      { name: "file", extract: (r) => r.file },
    ]),
    renderHelp(["Run `signatories-axi hook install` to load the documents dashboard each session"]),
  );
}

export async function hookCommand_(args: string[]): Promise<string> {
  const verb = args[0];
  const rest = args.slice(1);
  switch (verb) {
    case "install":
      return install(rest);
    case "uninstall":
      return uninstall(rest);
    case "status":
      return status();
    default:
      throw new AxiError(`unknown hook subcommand: ${verb ?? "(none)"}`, "USAGE", [
        "Use: hook install [--scope] [--dir] | hook uninstall [--scope] | hook status",
      ]);
  }
}
