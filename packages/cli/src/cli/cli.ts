import { AxiError, runAxiCli, type AxiCliCommand } from "axi-sdk-js";

import {
  LOGIN_HELP,
  LOGOUT_HELP,
  loginCommand,
  logoutCommand,
  WHOAMI_HELP,
  whoamiCommand,
} from "./commands/auth.js";
import { docsCommand, DOCS_HELP } from "./commands/docs.js";
import { feedbackCommand, FEEDBACK_HELP } from "./commands/feedback.js";
import { homeCommand } from "./commands/home.js";
import { hookCommand_, HOOK_HELP } from "./commands/hook.js";
import { initDataRepoCommand, INIT_DATA_REPO_HELP } from "./commands/instance.js";
import { notificationsCommand, NOTIFICATIONS_HELP } from "./commands/notifications.js";
import { operatorsCommand, OPERATORS_HELP } from "./commands/operators.js";
import { peopleCommand, PEOPLE_HELP } from "./commands/people.js";
import { signaturesCommand, SIGNATURES_HELP } from "./commands/signatures.js";
import { sitesCommand, SITES_HELP } from "./commands/sites.js";
import { submissionsCommand, SUBMISSIONS_HELP } from "./commands/submissions.js";
import { versionsCommand, VERSIONS_HELP } from "./commands/versions.js";
import { exitCodeForCode } from "./errors.js";
import { joinBlocks, renderHelp, renderObject } from "./output.js";
import { DESCRIPTION, renderCommandHelp, renderTopLevelHelp } from "./reference.js";

// Injected at build time by scripts/build-cli.ts (from `git describe`).
declare const __SIGNATORIES_AXI_VERSION__: string;
const VERSION =
  typeof __SIGNATORIES_AXI_VERSION__ === "string" ? __SIGNATORIES_AXI_VERSION__ : "dev";

const COMMAND_HELP: Record<string, string> = {
  login: LOGIN_HELP,
  logout: LOGOUT_HELP,
  whoami: WHOAMI_HELP,
  operators: OPERATORS_HELP,
  sites: SITES_HELP,
  docs: DOCS_HELP,
  versions: VERSIONS_HELP,
  people: PEOPLE_HELP,
  signatures: SIGNATURES_HELP,
  submissions: SUBMISSIONS_HELP,
  feedback: FEEDBACK_HELP,
  notifications: NOTIFICATIONS_HELP,
  "init-data-repo": INIT_DATA_REPO_HELP,
  hook: HOOK_HELP,
};

const COMMANDS: Record<string, AxiCliCommand<undefined>> = {
  // Registered under its own name (in addition to the required zero-arg
  // `home`) so the SessionStart hook can invoke `home --if-configured` —
  // the SDK rejects a leading flag before a command, so the bare zero-arg
  // form can never itself accept a flag (axi-skills § gotchas).
  home: homeCommand,
  login: loginCommand,
  logout: logoutCommand,
  whoami: whoamiCommand,
  operators: operatorsCommand,
  sites: sitesCommand,
  docs: docsCommand,
  versions: versionsCommand,
  people: peopleCommand,
  signatures: signaturesCommand,
  submissions: submissionsCommand,
  feedback: feedbackCommand,
  notifications: notificationsCommand,
  "init-data-repo": initDataRepoCommand,
  hook: hookCommand_,
};

/**
 * `specs/api/admin-cli.md` § Output rules: "Errors map API `error` codes to
 * exit codes: 2 validation, 3 phase/conflict, 4 not found, 5 auth, 1 other;
 * the message is the API's `message`." CLI-level usage errors (missing or
 * unknown flags) share the 2 bucket. Exported (rather than inlined into the
 * `runAxiCli` call) so it is unit-testable without exercising the full CLI
 * dispatch.
 */
export function formatError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    const details = (error as AxiError & { details?: Record<string, unknown> }).details;
    const head: Record<string, unknown> = { error: error.message, code: error.code };
    if (details && Object.keys(details).length > 0) head.details = details;
    return {
      output: `${joinBlocks(renderObject(head), renderHelp(error.suggestions))}\n`,
      exitCode: exitCodeForCode(error.code),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    output: `${renderObject({ error: `unexpected failure: ${message}`, code: "INTERNAL_ERROR" })}\n`,
    exitCode: 1,
  };
}

export interface MainOptions {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
}

/**
 * `signatories-axi --profile dinobot` (or `--json`) with no command means the
 * home view for that profile. The SDK rejects flags ahead of a command, so
 * a leading run of global flags is peeled off here and handed to `home`.
 */
function leadingGlobalFlags(argv: string[]): string[] | null {
  if (argv.length === 0) return null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") continue;
    if (arg === "--profile") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return null;
      i += 1;
      continue;
    }
    return null;
  }
  return argv;
}

export async function main(options: MainOptions = {}): Promise<void> {
  const rawArgv = options.argv ?? process.argv.slice(2);
  const homeArgs = leadingGlobalFlags(rawArgv);
  await runAxiCli<undefined>({
    description: DESCRIPTION,
    version: VERSION,
    argv: homeArgs ? [] : rawArgv,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    topLevelHelp: renderTopLevelHelp(),
    getCommandHelp: (command) => COMMAND_HELP[command] ?? renderCommandHelp(command),
    home: async () => homeCommand(homeArgs ?? []),
    commands: COMMANDS,
    formatError,
    // Hooks are managed explicitly via the `hook` command. The SDK's
    // auto-install is a no-op for a `.mjs`-named bundle anyway (it only
    // infers from `dist/bin/<name>.js` or an extension-less binary).
  });
}
