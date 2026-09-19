import { AxiError, runAxiCli, type AxiCliCommand } from "axi-sdk-js";

import { docsCommand, DOCS_HELP } from "./commands/docs.js";
import { feedbackCommand, FEEDBACK_HELP } from "./commands/feedback.js";
import { homeCommand } from "./commands/home.js";
import { hookCommand_, HOOK_HELP } from "./commands/hook.js";
import { initDataRepoCommand, INIT_DATA_REPO_HELP } from "./commands/instance.js";
import { notificationsCommand, NOTIFICATIONS_HELP } from "./commands/notifications.js";
import { peopleCommand, PEOPLE_HELP } from "./commands/people.js";
import { signaturesCommand, SIGNATURES_HELP } from "./commands/signatures.js";
import { submissionsCommand, SUBMISSIONS_HELP } from "./commands/submissions.js";
import { versionsCommand, VERSIONS_HELP } from "./commands/versions.js";
import { exitCodeForCode } from "./errors.js";
import { joinBlocks, renderHelp, renderObject } from "./output.js";
import { DESCRIPTION, renderCommandHelp, renderTopLevelHelp } from "./reference.js";

// Injected at build time by scripts/build-cli.ts (from `git describe`).
declare const __DRAFTER_AXI_VERSION__: string;
const VERSION = typeof __DRAFTER_AXI_VERSION__ === "string" ? __DRAFTER_AXI_VERSION__ : "dev";

const COMMAND_HELP: Record<string, string> = {
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

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<undefined>({
    description: DESCRIPTION,
    version: VERSION,
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    topLevelHelp: renderTopLevelHelp(),
    getCommandHelp: (command) => COMMAND_HELP[command] ?? renderCommandHelp(command),
    home: async () => homeCommand([]),
    commands: COMMANDS,
    formatError,
    // Hooks are managed explicitly via the `hook` command. The SDK's
    // auto-install is a no-op for a `.mjs`-named bundle anyway (it only
    // infers from `dist/bin/<name>.js` or an extension-less binary).
  });
}
