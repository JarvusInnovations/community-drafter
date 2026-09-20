/**
 * Single source of truth for the CLI's identity and command catalog
 * (`specs/api/admin-cli.md` § Commands). The home view's help, every
 * `--help` block, and the generated `skills/drafter-axi/SKILL.md` command
 * reference all derive from `COMMAND_GROUPS`, so the skill doc can never
 * drift from the implementation.
 */

export const DESCRIPTION =
  "Drive a community-drafter document from the shell — create, open, publish revisions, invite and track signers, and export feedback bundles for an LLM round.";

export interface CommandRef {
  usage: string;
  summary: string;
}

export interface CommandGroup {
  group: string;
  commands: CommandRef[];
}

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    group: "Session",
    commands: [
      {
        usage: "login <email> [--url <instance>]",
        summary:
          "Device-code sign-in: emails a magic link, prints a code to approve, then waits and saves a 90-day token to the profile.",
      },
      { usage: "logout", summary: "Forget the stored token for this profile." },
      { usage: "whoami", summary: "Show the signed-in operator and token expiry." },
    ],
  },
  {
    group: "Operators",
    commands: [
      { usage: "operators list", summary: "Every operator in the directory." },
      {
        usage:
          'operators add <email> --name "<text>" [--kind person|bot] [--title "<text>"] [--org "<text>"]',
        summary: "Create an operator.",
      },
      {
        usage:
          'operators update <email> [--name "<text>"] [--active true|false] [--title "<text>"] [--org "<text>"] [--notes "<text>"]',
        summary: "Update or deactivate an operator.",
      },
      { usage: "operators remove <email>", summary: "Remove an operator." },
    ],
  },
  {
    group: "Documents",
    commands: [
      {
        usage:
          'docs create <slug> --title "<text>" --sender-name "<text>" --reply-to <email> [--capacities personal,official] [--public none|read|participate] [--show-signatories list|count|none] [--revocation-window-hours <n>] [--tags a,b]',
        summary: "Create a document in draft; the caller becomes its first operator.",
      },
      { usage: "docs show <slug>", summary: "Dashboard numbers, versions, and schedule." },
      {
        usage: "docs open <slug> --comments-close <iso> --signing-closes <iso>",
        summary: "Open commenting and signing, and send invitations.",
      },
      {
        usage: "docs extend <slug> [--comments-close <iso>] [--signing-closes <iso>]",
        summary: "Push a deadline later (never earlier).",
      },
      { usage: "docs close <slug>", summary: "Close signing now." },
      {
        usage: "docs reopen <slug> [--comments-close <iso>] --signing-closes <iso>",
        summary: "Reopen a closed document.",
      },
      {
        usage: 'docs withdraw <slug> --reason "<text>" [--public]',
        summary: "Withdraw the document.",
      },
      { usage: "docs operators <slug>", summary: "List a document's operators." },
      {
        usage: "docs operators add <slug> <email>",
        summary: "Add an active operator to a document.",
      },
      {
        usage: "docs operators remove <slug> <email>",
        summary: "Remove an operator from a document (refused for the last one).",
      },
    ],
  },
  {
    group: "Versions",
    commands: [
      { usage: "versions list <slug>", summary: "Every published version, newest last." },
      { usage: "versions show <slug> <n> [--body]", summary: "One version, with dispositions." },
      {
        usage:
          'versions publish <slug> --file <path> --summary "<text>" [--notes-file <path>] [--final] [--dispositions <file.json>]',
        summary:
          "Publish a new version in one commit; prints the version number, commit subject, and notification counts.",
      },
      {
        usage: "versions compare <slug> <from> <to> [--unchanged]",
        summary: "A text redline between two versions.",
      },
    ],
  },
  {
    group: "People",
    commands: [
      {
        usage: "people import <slug> [<file.ndjson>|-] [--suggested-capacity personal|official]",
        summary:
          "Import invitees from NDJSON or a JSON array (a gitsheets people export works directly).",
      },
      {
        usage:
          "people list <slug> [--status <status>] [--source <source>] [-q <text>] [--contacts]",
        summary: "Participation statuses — never tokens; emails only with --contacts.",
      },
      {
        usage: "people links <slug> [--person a,b] [--out <file.csv>]",
        summary: "Export personal sign-in links (recorded).",
      },
      {
        usage: "people send <slug> [--only-unsent] [--person a,b]",
        summary: "Send invitations.",
      },
      {
        usage: "people remind <slug> --target unopened|opened-not-acted [--dry-run]",
        summary: "Send reminders to a target segment.",
      },
      { usage: "people revoke-link <slug> <person>", summary: "Revoke one person's link." },
      {
        usage: "people reissue-link <slug> <person>",
        summary: "Reissue one person's link (prints it once).",
      },
    ],
  },
  {
    group: "Signatures",
    commands: [
      {
        usage: "signatures list <slug> [--include-revoked] [--conditional]",
        summary: "Every signature, with sign/revoke dates.",
      },
      {
        usage: 'signatures revoke <slug> <person> --reason "<text>"',
        summary: "Admin revocation of a signature.",
      },
    ],
  },
  {
    group: "Submissions and feedback",
    commands: [
      {
        usage:
          "submissions list <slug> [--pending] [--version <n>] [--person <id>] [--include-drafts]",
        summary:
          "Whole submissions with their comments; drafts only on request, and always labeled.",
      },
      {
        usage: "feedback export <slug> [--format json|md] [--out <file>]",
        summary: "The LLM-round bundle — pipe straight into `versions publish --dispositions`.",
      },
    ],
  },
  {
    group: "Notifications",
    commands: [
      { usage: "notifications list <slug>", summary: "Sent, pending, and failed counts." },
      {
        usage: "notifications retry <slug> [--event <name>] [--person <id>]",
        summary: "Re-dispatch anything not yet notified.",
      },
    ],
  },
  {
    group: "Instance",
    commands: [
      {
        usage: "init-data-repo",
        summary: "First-boot helper: write sheet configs into an empty data repo.",
      },
    ],
  },
  {
    group: "Session",
    commands: [
      {
        usage:
          "hook install [--scope project|global] [--dir <path>] | hook status | hook uninstall [--scope project|global]",
        summary:
          "Manage the SessionStart hook that prints the home view (documents, deadlines, funnel counts) at the start of every agent session.",
      },
    ],
  },
];

function commandDoc(name: string): CommandRef | undefined {
  for (const group of COMMAND_GROUPS) {
    for (const doc of group.commands) {
      const first = doc.usage.split(" ")[0];
      if (first === name) return doc;
    }
  }
  return undefined;
}

/** Render the `--help` block for a single top-level command. */
export function renderCommandHelp(name: string): string | null {
  const doc = commandDoc(name);
  if (!doc) return null;
  const lines = [
    `usage: drafter-axi ${doc.usage}`,
    "",
    doc.summary,
    "",
    "`--json` prints raw JSON instead of TOON; `--profile <name>` (or DRAFTER_PROFILE) selects a config profile.",
  ];
  // The SDK writes this string verbatim, so the trailing newline is ours.
  return `${lines.join("\n")}\n`;
}

/** Render the top-level help listing every command by group. */
export function renderTopLevelHelp(): string {
  const lines = [`drafter-axi — ${DESCRIPTION}`, "", "usage: drafter-axi <command> [args] [flags]"];

  for (const group of COMMAND_GROUPS) {
    lines.push("", `${group.group}:`);
    for (const doc of group.commands) {
      lines.push(`  ${doc.usage}`);
      lines.push(`      ${doc.summary}`);
    }
  }

  lines.push(
    "",
    "Config: run `login <email> --url <instance>` once, or set DRAFTER_URL / DRAFTER_TOKEN in the environment.",
    "`--json` prints raw JSON instead of TOON; `--profile <name>` (or DRAFTER_PROFILE) selects a config profile.",
    "Run `drafter-axi <command> --help` for usage on any command.",
    "Run `drafter-axi` with no arguments to see every open document's status.",
  );

  return lines.join("\n");
}
