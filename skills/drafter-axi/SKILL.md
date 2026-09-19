---
name: drafter-axi
description: Drive a community-drafter document from the shell — create it, publish revisions, invite and track signers, export the pending-feedback bundle for an LLM disposition round, and check in on every open document at the start of a session. Use whenever a task involves a community-drafter admin API instance (DRAFTER_URL/DRAFTER_ADMIN_TOKEN), a document slug, invitations, signatures, or publishing a version.
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

## Configuration

Set `DRAFTER_URL` and `DRAFTER_ADMIN_TOKEN` in the environment before running any command, or add
them to `~/.config/drafter/<profile>.toml` as `url = "..."` and `admin_token = "..."` (select a
non-default profile with `--profile <name>`). `--actor <label>` sets the `X-Actor` header recorded
on every write (default: `cli:<os user>`).

```sh
export DRAFTER_URL=https://drafts.example.org
export DRAFTER_ADMIN_TOKEN=...
scripts/drafter-axi
```

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

### Documents

- `scripts/drafter-axi docs create <slug> --title "<text>" --owner <email> --sender-name "<text>" --reply-to <email> [--capacities personal,official] [--public none|read|participate] [--show-signatories list|count|none] [--revocation-window-hours <n>] [--tags a,b]` — Create a document in draft.
- `scripts/drafter-axi docs show <slug>` — Dashboard numbers, versions, and schedule.
- `scripts/drafter-axi docs open <slug> --comments-close <iso> --signing-closes <iso>` — Open commenting and signing, and send invitations.
- `scripts/drafter-axi docs extend <slug> [--comments-close <iso>] [--signing-closes <iso>]` — Push a deadline later (never earlier).
- `scripts/drafter-axi docs close <slug>` — Close signing now.
- `scripts/drafter-axi docs reopen <slug> [--comments-close <iso>] --signing-closes <iso>` — Reopen a closed document.
- `scripts/drafter-axi docs withdraw <slug> --reason "<text>" [--public]` — Withdraw the document.

### Versions

- `scripts/drafter-axi versions list <slug>` — Every published version, newest last.
- `scripts/drafter-axi versions show <slug> <n> [--body]` — One version, with dispositions.
- `scripts/drafter-axi versions publish <slug> --file <path> --summary "<text>" [--notes-file <path>] [--final] [--dispositions <file.json>]` — Publish a new version in one commit; prints the version number, commit subject, and notification counts.
- `scripts/drafter-axi versions compare <slug> <from> <to> [--unchanged]` — A text redline between two versions.

### People

- `scripts/drafter-axi people import <slug> [<file.ndjson>|-] [--suggested-capacity personal|official]` — Import invitees from NDJSON or a JSON array (a gitsheets people export works directly).
- `scripts/drafter-axi people list <slug> [--status <status>] [--source <source>] [-q <text>] [--contacts]` — Participation statuses — never tokens; emails only with --contacts.
- `scripts/drafter-axi people links <slug> [--person a,b] [--out <file.csv>]` — Export personal sign-in links (recorded).
- `scripts/drafter-axi people send <slug> [--only-unsent] [--person a,b]` — Send invitations.
- `scripts/drafter-axi people remind <slug> --target unopened|opened-not-acted [--dry-run]` — Send reminders to a target segment.
- `scripts/drafter-axi people revoke-link <slug> <person>` — Revoke one person's link.
- `scripts/drafter-axi people reissue-link <slug> <person>` — Reissue one person's link (prints it once).

### Signatures

- `scripts/drafter-axi signatures list <slug> [--include-revoked] [--conditional]` — Every signature, with sign/revoke dates.
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
