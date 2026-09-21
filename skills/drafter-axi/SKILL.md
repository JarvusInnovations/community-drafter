---
name: drafter-axi
description: Drive a community-drafter document from the shell — sign in, create a document, publish revisions, invite and track signers, export the pending-feedback bundle for an LLM disposition round, and check in on every open document at the start of a session. Use whenever a task involves a community-drafter admin API instance (DRAFTER_URL/DRAFTER_TOKEN, or `login`), a document slug, invitations, signatures, or publishing a version.
metadata:
  internal: false
---

# drafter-axi

An agent-facing CLI over community-drafter's admin API (`specs/api/admin.md`), built to the
[AXI](https://github.com/kunchenguid/axi) conventions: TOON output by default, `--json` for raw,
idempotent mutations, stable exit codes, and a no-argument "home" view showing every open
document's status. This is the **primary admin interface** to a community-drafter instance — an
adopting team installs this skill into their own repo and drives documents from there: importing
invitees from that repo's own people sheet, publishing revisions their agent drafted, and reading
progress every session.

The bundled CLI is **not on PATH**. Always invoke it as `scripts/drafter-axi <command>` from this
skill's directory — never `node scripts/drafter-axi` (it's a bash shim, not a Node script) and
never a bare `drafter-axi` (that assumes a global install this skill doesn't provide). If output
elsewhere shows a follow-up command starting with `drafter-axi`, run it as
`scripts/drafter-axi …` instead.

## Quickstart (for a person)

Six steps take a document from nothing to signatures. Run them from this skill's directory;
`<instance>` is the address of the community-drafter deployment your group uses, and
`<slug>` is a short name you pick for the document (`board-letter`, `charter-2026`).

1. **Sign in.** `scripts/drafter-axi login you@example.org --url https://<instance>` prints an
   8-character code and waits. Open the link that lands in your inbox, check the code on the
   page matches the one in your terminal, and click Approve. That is the only sign-in there is —
   no password, and the token lasts 90 days.
2. **Create the document.**
   `scripts/drafter-axi docs create <slug> --title "Our statement" --sender-name "Our Coalition" --reply-to you@example.org`
   You become its first operator. Nothing is visible to anyone yet.
3. **Publish the text.** Write the statement as Markdown in a file, then
   `scripts/drafter-axi versions publish <slug> --file draft.md --summary "Initial draft"`.
   Every later revision is another `versions publish` with its own one-line summary.
4. **Open it on a clock.**
   `scripts/drafter-axi docs open <slug> --comments-close 2026-10-01T17:00 --signing-closes 2026-10-08T17:00`
   Give a zone (`…Z`, `…-04:00`) or a zone-less time, which is read in this machine's local
   zone; the command echoes what it resolved to, so check that line before walking away.
5. **Invite people.** Put one JSON object per line in a file — `{"email": "...", "name": "..."}`,
   plus optional `org`, `role`, `descriptor`, `suggested_capacity` — then
   `scripts/drafter-axi people import <slug> invitees.ndjson --dry-run` to see what it would do,
   and again without `--dry-run` to write it. `scripts/drafter-axi people send <slug>` mails each
   person their own link and prints how many went out; anyone the mail provider rejected is named
   with the reason and stays `not_sent`, so fix the address and run `people send` again.
   Run `people import --help` for the full field list.
6. **Revise.** `scripts/drafter-axi feedback export <slug> --format md` gives you every pending
   comment. Answer them by publishing again with a dispositions file, where each comment gets one
   of four outcomes — `accepted`, `partial`, `declined`, `noted`:
   `scripts/drafter-axi versions publish <slug> --file v2.md --summary "…" --dispositions d.json`.

**There is also a web console.** Sign in at `https://<instance>/admin` with the same email address
and you get a read view of everything above: progress and deadlines, the people you invited and
where each one stands, submissions and their comments, versions, and "view as" — the exact page a
given person was sent. Writing still happens here, on the command line.

Check on things any time with `scripts/drafter-axi` alone (every document, with counts) or
`scripts/drafter-axi docs show <slug>`.

## Configuration

Run `scripts/drafter-axi login you@example.org --url https://drafts.example.org` once: it sends a
sign-in link to that address, prints an 8-character code, and waits for a human (you, or the
mailbox owner for a bot operator) to open the link and approve the device. On approval it writes
the instance URL, the operator's email, and a 90-day token to `~/.config/drafter/<profile>.toml`
(mode 600) — every later command reads from there, and the CLI refreshes the token silently once
it's more than 30 days old. Select a non-default profile with `--profile <name>`.

```sh
scripts/drafter-axi login you@example.org --url https://drafts.example.org
scripts/drafter-axi
```

For CI or a bot with no profile file, set `DRAFTER_URL` and `DRAFTER_TOKEN` in the environment
instead — either overrides the profile independently. There is no actor label any more: every
write is attributed to the signed-in operator. `scripts/drafter-axi whoami` shows who that is and
when the token expires; `scripts/drafter-axi logout` forgets it.

## Output

TOON by default (~40% fewer tokens than JSON for the same data); pass `--json` on any command for
the raw response instead. `people list` and `docs show` never print participant tokens or emails
unless `--contacts` is passed (and even then, only emails — never tokens). `people links` and
`people reissue-link` are the only commands that return a token; treat that output like a
credential.

Errors map the API's own `error` code to an exit code: `2` validation, `3` phase/conflict, `4` not
found, `5` auth, `1` everything else. The printed message is always the API's own `message`.

## The publish loop

`feedback export <slug>` (the pending-comment bundle, organized by submission) is the input to an
LLM disposition pass; its output is a dispositions JSON file
(`[{submission, comment, outcome, note?}, ...]`) that feeds straight into
`versions publish <slug> --file <new-body> --summary "..." --dispositions <file.json>` — a
two-command round trip with no manual step in between. Every mutation prints the resulting
record's key fields and the commit subject, so you can cite exactly what changed.

## Session hook

`scripts/drafter-axi hook install` (run once, from a repo that has installed this skill) writes a
SessionStart hook to `.claude/settings.json` that prints the documents dashboard — phase, next
deadline, invited/opened/signed counts, notification failures — at the start of every agent session
in that repo, but only when `DRAFTER_URL` is set; it stays silent otherwise. Default scope is
`project` (committed, portable across contributors); pass `--scope global` for a single operator's
every-session use instead.

## Commands

<!-- BEGIN GENERATED: command-reference -->

### Session

- `scripts/drafter-axi login <email> [--url <instance>]` — Device-code sign-in: emails a magic link, prints a code to approve, then waits and saves a 90-day token to the profile.
- `scripts/drafter-axi logout` — Forget the stored token for this profile.
- `scripts/drafter-axi whoami` — Show the signed-in operator and token expiry.

### Operators

- `scripts/drafter-axi operators list` — Every operator in the directory.
- `scripts/drafter-axi operators add <email> --name "<text>" [--kind person|bot] [--title "<text>"] [--org "<text>"]` — Create an operator.
- `scripts/drafter-axi operators update <email> [--name "<text>"] [--active true|false] [--superadmin true|false] [--title "<text>"] [--org "<text>"] [--notes "<text>"]` — Update or deactivate an operator; --superadmin is grantable only by another superadmin.
- `scripts/drafter-axi operators remove <email>` — Remove an operator.

### Documents

- `scripts/drafter-axi docs create <slug> --title "<text>" --audience public|closed --sender-name "<text>" --reply-to <email> [--addressed-to "<name>"]... [--capacities personal,official] [--show-signatories list|count|none] [--revocation-window-hours <n>] [--tags a,b]` — Create a document in draft; the caller becomes its first operator. --audience is required and says who the finished statement is for: public (published for anyone to read) or closed (delivered to the people and bodies it is addressed to). --addressed-to names one recipient and repeats; it is required with --audience closed. Neither touches --public, which is whether anyone with the link may read the working draft.
- `scripts/drafter-axi docs show <slug>` — Dashboard numbers, versions, and schedule; prints the audience, who the statement is addressed to, and public_url when the document is publicly readable.
- `scripts/drafter-axi docs update <slug> [--audience public|closed] [--addressed-to "<name>"]...` — Change the audience and who the statement is addressed to, and nothing else. --addressed-to replaces the recipients.
- `scripts/drafter-axi docs open <slug> --comments-close <iso> --signing-closes <iso>` — Open commenting and signing, and send invitations.
- `scripts/drafter-axi docs extend <slug> [--comments-close <iso>] [--signing-closes <iso>]` — Push a deadline later (never earlier).
- `scripts/drafter-axi docs close <slug>` — Close signing now.
- `scripts/drafter-axi docs reopen <slug> [--comments-close <iso>] --signing-closes <iso>` — Reopen a closed document.
- `scripts/drafter-axi docs withdraw <slug> --reason "<text>" [--public]` — Withdraw the document.
- `scripts/drafter-axi docs operators <slug>` — List a document's operators.
- `scripts/drafter-axi docs operators add <slug> <email>` — Add an active operator to a document.
- `scripts/drafter-axi docs operators remove <slug> <email>` — Remove an operator from a document (refused for the last one).

### Versions

- `scripts/drafter-axi versions list <slug>` — Every published version, newest last.
- `scripts/drafter-axi versions show <slug> <n> [--body]` — One version, with dispositions.
- `scripts/drafter-axi versions publish <slug> --file <path> --summary "<text>" [--notes-file <path>] [--final] [--dispositions <file.json>]` — Publish a new version in one commit; prints the version number, commit subject, and notification counts. A --dispositions entry's outcome is one of accepted, partial, declined or noted.
- `scripts/drafter-axi versions compare <slug> <from> <to> [--unchanged]` — A text redline between two versions.

### People

- `scripts/drafter-axi people import <slug> [<file.ndjson>|-] [--suggested-capacity personal|official] [--dry-run]` — Import invitees from NDJSON or a JSON array (a gitsheets people export works directly); rows carry email and name plus optional org, role, phone, descriptor, external_id, suggested_capacity and tags, and --dry-run shows what each row would do first. Run `people import --help` for the full field list.
- `scripts/drafter-axi people list <slug> [--status <status>] [--source <source>] [-q <text>] [--contacts]` — Participation statuses — never tokens; emails only with --contacts.
- `scripts/drafter-axi people links <slug> [--person a,b] [--out <file.csv>]` — Export personal sign-in links (recorded).
- `scripts/drafter-axi people remove <slug> <person>` — Take back a staged invitation that was never sent.
- `scripts/drafter-axi people send <slug> [--only-unsent] [--person a,b] [--dry-run]` — Send invitations, reporting what was delivered and what the mailer rejected; --dry-run lists who would receive one and who is skipped and why.
- `scripts/drafter-axi people remind <slug> --target unopened|opened-not-acted [--min-age <hours>] [--dry-run]` — Send reminders to a target segment, skipping anyone messaged within --min-age hours (default 48; 0 sends regardless).
- `scripts/drafter-axi people revoke-link <slug> <person>` — Revoke one person's link.
- `scripts/drafter-axi people reissue-link <slug> <person>` — Reissue one person's link (prints it once).

### Signatures

- `scripts/drafter-axi signatures list <slug> [--include-revoked] [--conditional]` — Every signature, with its version, sign/revoke dates and whether it is behind.
- `scripts/drafter-axi signatures revoke <slug> <person> --reason "<text>"` — Admin revocation of a signature.

### Submissions and feedback

- `scripts/drafter-axi submissions list <slug> [--pending] [--version <n>] [--person <id>] [--include-drafts]` — Whole submissions with their comments; drafts only on request, and always labeled.
- `scripts/drafter-axi feedback export <slug> [--format json|md] [--out <file>]` — The LLM-round bundle — pipe straight into `versions publish --dispositions`.

### Notifications

- `scripts/drafter-axi notifications list <slug>` — Sent, pending, and failed counts.
- `scripts/drafter-axi notifications retry <slug> [--event <name>] [--person <id>]` — Re-dispatch anything not yet notified.

### Instance

- `scripts/drafter-axi init-data-repo` — First-boot helper: write sheet configs into an empty data repo.

### Session

- `scripts/drafter-axi hook install [--scope project|global] [--dir <path>] | hook status | hook uninstall [--scope project|global]` — Manage the SessionStart hook that prints the home view (documents, deadlines, funnel counts) at the start of every agent session.

<!-- END GENERATED: command-reference -->
