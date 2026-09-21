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
          "Device-code sign-in: the URL's hostname picks the site, and the resulting token is good on that host only. Emails a magic link, prints a code to approve, then waits and saves a 90-day token to the profile.",
      },
      { usage: "logout", summary: "Forget the stored token for this profile." },
      {
        usage: "whoami",
        summary:
          "Show the signed-in operator, the site this credential belongs to, and the token expiry.",
      },
    ],
  },
  {
    group: "Sites",
    commands: [
      {
        usage: "sites list",
        summary:
          "The caller's sites: hostname, name, the From address mail will actually use, operator and document counts, and whether the hostname and the sender are verified yet.",
      },
      {
        usage: "sites show <slug>",
        summary: "One site whole, with the DNS records it still needs.",
      },
      {
        usage:
          'sites create <slug> --hostname <host> --name "<text>" --reply-to <email> [--sender-name "<text>"] [--sender-email <email>] [--logo-url <https url>] [--accent <#rrggbb>]',
        summary:
          "Create a site (superadmin). Prints the record, then every DNS record the customer must add — the CNAME for the hostname and, with --sender-email, the mail provider's DKIM and Return-Path records — and says plainly that creating the record routes nothing.",
      },
      {
        usage:
          'sites update <slug> [--name "<text>"] [--reply-to <email>] [--sender-name "<text>"] [--sender-email <email>] [--logo-url <https url>] [--accent <#rrggbb>]',
        summary:
          "Change a site's identity (superadmin); --hostname is deliberately absent — a site has exactly one hostname, and a new one is a new site.",
      },
      {
        usage: "sites remove <slug>",
        summary:
          "Delete a site (superadmin); refused while any document names it, naming the documents.",
      },
      {
        usage:
          "sites operators <slug> | sites operators add <slug> <email> | sites operators remove <slug> <email>",
        summary:
          "The site's operator group; any operator of the site may change it, and remove drops the email from this site only.",
      },
    ],
  },
  {
    group: "Operators",
    commands: [
      {
        usage: "operators list",
        summary: "This site's operator group — not every operator on the instance.",
      },
      {
        usage:
          'operators add <email> --name "<text>" [--kind person|bot] [--title "<text>"] [--org "<text>"]',
        summary: "Create an operator.",
      },
      {
        usage:
          'operators update <email> [--name "<text>"] [--active true|false] [--superadmin true|false] [--title "<text>"] [--org "<text>"] [--notes "<text>"]',
        summary:
          "Update or deactivate an operator; --superadmin is grantable only by another superadmin.",
      },
      {
        usage: "operators remove <email>",
        summary:
          "Delete an operator record outright (superadmin): removes them from every site and document. To take someone off one site, use `sites operators remove`.",
      },
    ],
  },
  {
    group: "Documents",
    commands: [
      {
        usage:
          'docs create <slug> --title "<text>" --audience public|closed [--site <slug>] [--sender-name "<text>"] [--reply-to <email>] [--addressed-to "<name>"]... [--capacities personal,official] [--show-signatories list|count|none] [--revocation-window-hours <n>] [--tags a,b]',
        summary:
          "Create a document in draft; the caller becomes its first operator. --site names the site it belongs to (default: the site this profile is signed in to), which decides the hostname its links and mail are built on; --sender-name and --reply-to fall back to the site's. --audience is required and says who the finished statement is for: public (published for anyone to read) or closed (delivered to the people and bodies it is addressed to). --addressed-to names one recipient and repeats; it is required with --audience closed. Neither touches --public, which is whether anyone with the link may read the working draft.",
      },
      {
        usage: "docs show <slug>",
        summary:
          "Dashboard numbers, versions, and schedule; prints the site and the canonical host its links are built on, the audience, who the statement is addressed to, and public_url when the document is publicly readable.",
      },
      {
        usage:
          'docs update <slug> [--audience public|closed] [--addressed-to "<name>"]... [--site <slug>]',
        summary:
          "Change the audience, who the statement is addressed to, and the site, and nothing else. --site moves the document to another site you operate: the slug, tokens and history do not change, the hostname its participants are sent to does. --addressed-to replaces the recipients.",
      },
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
        summary:
          "Add an operator to a document, drawing only from the document's site's operator group.",
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
          "Publish a new version in one commit; prints the version number, commit subject, and notification counts. A --dispositions entry's outcome is one of accepted, partial, declined or noted.",
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
        usage:
          "people import <slug> [<file.ndjson>|-] [--suggested-capacity personal|official] [--dry-run]",
        summary:
          "Import invitees from NDJSON or a JSON array (a gitsheets people export works directly); rows carry email and name plus optional org, role, phone, descriptor, external_id, suggested_capacity and tags, and --dry-run shows what each row would do first. Run `people import --help` for the full field list.",
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
        usage: "people remove <slug> <person>",
        summary: "Take back a staged invitation that was never sent.",
      },
      {
        usage: "people send <slug> [--only-unsent] [--person a,b] [--dry-run]",
        summary:
          "Send invitations, reporting what was delivered and what the mailer rejected; --dry-run lists who would receive one and who is skipped and why.",
      },
      {
        usage:
          "people remind <slug> --target unopened|opened-not-acted [--min-age <hours>] [--dry-run]",
        summary:
          "Send reminders to a target segment, skipping anyone messaged within --min-age hours (default 48; 0 sends regardless).",
      },
      { usage: "people revoke-link <slug> <person>", summary: "Revoke one person's link." },
      {
        usage: "people reissue-link <slug> <person>",
        summary: "Reissue one person's link (prints it once).",
      },
      {
        usage: "people expire <slug> <person> --expires-at <when>",
        summary:
          "Set when one person's link stops working; <when> takes the same grammar as docs open (ISO 8601 with a zone, or a zone-less time read locally) and the resolved instant is printed back.",
      },
    ],
  },
  {
    group: "Signatures",
    commands: [
      {
        usage: "signatures list <slug> [--include-revoked] [--conditional]",
        summary: "Every signature, with its version, sign/revoke dates and whether it is behind.",
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
