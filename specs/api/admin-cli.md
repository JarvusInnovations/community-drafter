# API: Admin CLI

An agent-facing command-line tool over `api/admin.md`, built to the AXI conventions (TOON output by default, `--json` for raw, idempotent mutations, stable error codes, a no-argument "home" view). Working name: `drafter-axi`.

## Distribution: a skill with the CLI embedded

This is the **primary admin interface** of the system, and it ships as a **skill** in this repository (`skills/drafter-axi/`) whose `scripts/` holds the committed, self-contained bundle built from `packages/cli/` per `axi-skills`. An adopting team installs it into *their* repo (`npx skills add JarvusInnovations/community-drafter --skill drafter-axi`), and their own agent drives documents from there: import invitees from that repo's own gitsheets people sheet, publish revisions its agent drafted, read progress every session. The CLI is not published to npm; the bundle in the skill is the artifact, and a CI drift gate keeps it in sync with the source.

## Configuration

The instance URL and the credential live in `~/.config/drafter/<profile>.toml` (mode 600), written by `drafter-axi login`. `login` takes the instance URL as an argument (`--url https://…`, or `DRAFTER_URL` from the environment when the flag is absent) and saves it to the profile alongside the token, so later commands need neither the flag nor the variable. `DRAFTER_URL` and `DRAFTER_TOKEN` in the environment override the profile for CI and bots. `--profile <name>` selects a profile; the default is `default`. There is no actor label: every write is attributed to the signed-in operator.

## Commands

| Command | Does |
| --- | --- |
| `drafter-axi` | home: the signed-in operator's documents with phase, next deadline, invited/opened/signed counts, failures; when not signed in, says so and how to `login` |
| `login <email> [--url <instance>]` | device-code sign-in against `--url` (or `DRAFTER_URL`; refused if neither is given): sends the magic link, prints the user code, waits for approval, then saves the URL, email and 90-day token to the profile |
| `logout` / `whoami` | forget the token / show operator and expiry |
| `operators list` | every operator |
| `operators add <email> --name … [--kind person\|bot] [--title …] [--org …]` | create |
| `operators update <email> [--name …] [--active true\|false] [--title …] [--org …] [--notes …]` | update or deactivate |
| `operators remove <email>` | remove |
| `docs operators <slug>` / `docs operators add <slug> <email>` / `docs operators remove <slug> <email>` | document membership |
| `docs create <slug> --title … --sender-name … --reply-to … [--capacities personal,official] [--public read] [--show-signatories list]` | create; the caller becomes the first operator |
| `docs show <slug>` | dashboard numbers, versions, schedule |
| `docs open <slug> --comments-close <iso> --signing-closes <iso>` | open and send invitations |
| `docs extend <slug> [--comments-close <iso>] [--signing-closes <iso>]` | extension |
| `docs close|reopen|withdraw <slug> …` | lifecycle |
| `versions list <slug>` / `versions show <slug> <n> [--body]` | read |
| `versions publish <slug> --file new.md --summary "…" [--notes-file …] [--final] [--dispositions d.json]` | publish: one commit whose trailers carry the summary; prints version number, commit subject, notification counts |
| `versions compare <slug> <from> <to> [--unchanged]` | text redline for a terminal |
| `people import <slug> [file.ndjson \| -] [--suggested-capacity official]` | import invitees; accepts a gitsheets people sheet's NDJSON export directly |
| `people list <slug> [--status signed] [--source crm] [-q name]` | statuses, no tokens |
| `people links <slug> [--person a,b] [--out links.csv]` | export personal links (recorded) |
| `people send <slug> [--only-unsent]` | send invitations |
| `people remind <slug> --target unopened\|opened-not-acted [--dry-run]` | reminders |
| `people revoke-link|reissue-link <slug> <person>` | link management |
| `signatures list <slug> [--include-revoked] [--conditional]` | signatures |
| `signatures revoke <slug> <person> --reason "…"` | admin revocation |
| `submissions list <slug> [--pending] [--version n] [--person p] [--include-drafts]` | whole submissions, each with its comments; drafts only on request and always labeled |
| `feedback export <slug> [--format json\|md] [--out …]` | the LLM-round bundle |
| `notifications list <slug> --status failed` / `notifications retry <slug>` | health |
| `init-data-repo` | first-boot helper |

## Output rules

- Every mutation prints the resulting record's key fields and the commit subject.
- `people list` and `docs show` never print tokens or emails unless `--contacts` is passed (emails only, still never tokens).
- Errors map API `error` codes to exit codes: 2 validation, 3 phase/conflict, 4 not found, 5 auth, 1 other; the message is the API's `message`.
- The home view includes `help[]` lines suggesting the next likely command, per AXI.

## Session hook

Per `axi-skills`, the skill ships a SessionStart hook that prints the home view when `DRAFTER_URL` is set, so an agent in the adopting repo opens every session knowing where each open document stands.

## Principles

**Inherited**
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): the CLI is how the team's agent participates in the record; commit subjects in output let it cite what it did.

**Local**
- **Publishing from the CLI is the LLM loop's output path.** `feedback export` → agent → `versions publish --dispositions` must be a two-command round trip with no manual step in between, or the bulk-rounds promise fails.
