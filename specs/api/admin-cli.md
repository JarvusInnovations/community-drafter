# API: Admin CLI

An agent-facing command-line tool over `api/admin.md`, built to the AXI conventions (TOON output by default, `--json` for raw, idempotent mutations, stable error codes, a no-argument "home" view). Working name: `drafter-axi`.

## Distribution: a skill with the CLI embedded

This is the **primary admin interface** of the system, and it ships as a **skill** in this repository (`skills/drafter-axi/`) whose `scripts/` holds the committed, self-contained bundle built from `packages/cli/` per `axi-skills`. An adopting team installs it into *their* repo (`npx skills add JarvusInnovations/community-drafter --skill drafter-axi`), and their own agent drives documents from there: import invitees from that repo's own gitsheets people sheet, publish revisions its agent drafted, read progress every session. The CLI is not published to npm; the bundle in the skill is the artifact, and a CI drift gate keeps it in sync with the source.

`SKILL.md` opens with a **quickstart written for a person**, not for an agent: sign in, create, publish, open, invite, revise — six numbered steps with the literal commands, plus the one line that says the web console at `<instance>/admin` is where you read what happened. The agent-facing material (TOON, the disposition loop, the session hook, the generated command reference) follows it. A first-time operator who reads only the top of the file can run a document; an agent that reads the whole file loses nothing.

## Configuration

The instance URL and the credential live in `~/.config/drafter/<profile>.toml` (mode 600), written by `drafter-axi login`. `login` takes the instance URL as an argument (`--url https://…`, or `DRAFTER_URL` from the environment when the flag is absent) and saves it to the profile alongside the token, so later commands need neither the flag nor the variable. `DRAFTER_URL` and `DRAFTER_TOKEN` in the environment override the profile for CI and bots. The profile is selected by `--profile <name>`, else the `DRAFTER_PROFILE` environment variable, else `default`; a bot runs under its own operator by exporting `DRAFTER_PROFILE=<bot>` once and never touching the human's default profile. There is no actor label: every write is attributed to the signed-in operator.

## Commands

| Command | Does |
| --- | --- |
| `drafter-axi` | home: first the identity line (signed-in operator's email, name and kind, the instance URL, the profile in use), then that operator's documents with phase, next deadline, invited/opened/signed counts, failures; when not signed in, says so and how to `login`; when the stored token is expired or revoked, says that and how to `login` again |
| `login <email> [--url <instance>]` | device-code sign-in against `--url` (or `DRAFTER_URL`; refused if neither is given): sends the magic link, prints the user code, waits for approval, then saves the URL, email and 90-day token to the profile |
| `logout` / `whoami` | forget the token / show operator and expiry |
| `operators list` | every operator |
| `operators add <email> --name … [--kind person\|bot] [--title …] [--org …]` | create |
| `operators update <email> [--name …] [--active true\|false] [--superadmin true\|false] [--title …] [--org …] [--notes …]` | update, deactivate, or (superadmins only) grant or revoke superadmin |
| `operators remove <email>` | remove |
| `docs operators <slug>` / `docs operators add <slug> <email>` / `docs operators remove <slug> <email>` | document membership |
| `docs create <slug> --title … --audience public\|closed --sender-name … --reply-to … [--addressed-to "…"]… [--capacities personal,official] [--show-signatories list]` | create; the caller becomes the first operator. `--audience` is **required** — who the finished statement is for is not a thing to default into (`specs/data-model.md` § Audience) — and is stored as given, never written to `public_access`. `--addressed-to` names who the statement goes to and is repeatable, once per recipient; it is required with `--audience closed` |
| `docs show <slug>` | dashboard numbers (including how many signatures are behind the current version), the audience and who the statement is addressed to, versions, schedule |
| `docs open <slug> --comments-close <when> --signing-closes <when>` | open and send invitations, printing how many were delivered and naming any the mailer rejected; `<when>` is ISO 8601 with a zone, or a zone-less time read in the machine's local zone, and the CLI echoes what it resolved to |
| `docs extend <slug> [--comments-close <when>] [--signing-closes <when>]` | extension |
| `docs update <slug> [--audience public\|closed] [--addressed-to "…"]…` | change the audience and who the statement is addressed to, and nothing else (`PATCH /documents/:slug`). Passing `--addressed-to` replaces the list; `--audience closed` on a document that would be left with no recipients is refused, naming the flag |
| `docs close | reopen | withdraw <slug> …` | lifecycle |
| `versions list <slug>` / `versions show <slug> <n> [--body]` | read |
| `versions publish <slug> --file new.md --summary "…" [--notes-file …] [--final] [--dispositions d.json]` | publish: one commit whose trailers carry the summary; prints version number, commit subject, notification counts |
| `versions compare <slug> <from> <to> [--unchanged]` | text redline for a terminal |
| `people import <slug> [file.ndjson \| -] [--suggested-capacity official] [--dry-run]` | import invitees; accepts a gitsheets people sheet's NDJSON export directly; `--dry-run` shows what each row would do without writing |
| `people remove <slug> <person>` | remove a staged invitation that was never sent |
| `people list <slug> [--status not_sent\|signed\|…] [--source crm] [-q name]` | statuses (staged invitations read `not_sent`), no tokens |
| `people links <slug> [--person a,b] [--out links.csv]` | export personal links (recorded) |
| `people send <slug> [--only-unsent] [--person a,b] [--dry-run]` | send invitations; prints how many were delivered, how many failed and who with what error; `--dry-run` lists who would receive one and who is skipped and why |
| `people remind <slug> --target unopened\|opened-not-acted [--min-age <hours>] [--dry-run]` | reminders; skips anyone this document messaged within `--min-age` hours (default 48, `0` to send regardless) and prints what it actually sent, how many were skipped as recently messaged and how many by preference |
| `people revoke-link | reissue-link <slug> <person>` | link management |
| `people expire <slug> <person> --expires-at <when>` | set when one person's link stops working. `<when>` takes the same grammar as `docs open` — ISO 8601 with a zone, or a zone-less time read in the machine's local zone — and the CLI echoes what it resolved to, so an expiry is never a hand-written UTC guess |
| `signatures list <slug> [--include-revoked] [--conditional]` | signatures, each with the version it is attached to and whether it is behind the current version |
| `signatures revoke <slug> <person> --reason "…"` | admin revocation |
| `submissions list <slug> [--pending] [--version n] [--person p] [--include-drafts]` | whole submissions, each with its comments; drafts only on request and always labeled |
| `feedback export <slug> [--format json\|md] [--out …]` | the LLM-round bundle |
| `notifications list <slug> --status failed` / `notifications retry <slug>` | health |
| `init-data-repo` | first-boot helper |

## Output rules

- Every mutation prints the resulting record's key fields and the commit subject.
- `people list` and `docs show` never print tokens or emails unless `--contacts` is passed (emails only, still never tokens).
- **Every document view prints `audience`** — `public` or `closed` — and, whenever recipients are named, `addressed_to`, both as stored. They sit beside `public_access` in the same object, because an operator reading a document needs to see at a glance that who the statement goes to and who may read the draft are two different answers (`specs/data-model.md` § Audience). A document stored without `audience` prints `closed`.
- **`docs create`, `docs show` and `docs open` print `public_url`** — `<instance>/d/<slug>` — whenever the document's `public_access` is not `none`, so the address an operator hands to their own site or newsletter never has to be guessed or assembled by hand. A document with `public_access: none` prints no such field.
- Errors map API `error` codes to exit codes: 2 validation, 3 phase/conflict, 4 not found, 5 auth, 1 other; the message is the API's `message`.
- The home view includes `help[]` lines suggesting the next likely command, per AXI.
- **One invocation form per surface.** Everything the CLI itself emits — `help[]` hints, error suggestions, hook output, `--help` usage lines — writes commands as `drafter-axi <command> …`, never a resolved path. The resolved path of the bundled shim (which is not on `PATH`) appears exactly once, as the home view's `invoke_as` field, which is where a reader learns how to turn those hints into a runnable command. `SKILL.md` is the other surface and uses `scripts/drafter-axi` throughout, stated once at its top; within either surface the form never varies.

## Help

`--help` on a command is the command's whole contract, because an agent (or a first-time operator) will not read the spec:

- **`people import --help`** lists the row fields by their exact names — `email` and `name` required; `phone`, `org`, `role`, `descriptor`, `external_id`, `suggested_capacity`, `tags` optional — says that any other key is ignored (so `organization` or `title` silently does nothing), and points at `--dry-run` as the way to see what a file would do before it writes.
- **`versions publish --help`** lists the four disposition outcomes with one line each: `accepted` (incorporated), `partial` (partly addressed, note expected), `declined` (not incorporated, note required), `noted` (read and noted, no text change) — per `behaviors/review-and-judgement.md`. An `outcome` outside that set is a validation error, never a silent pass.

## Session hook

Per `axi-skills`, the skill ships a SessionStart hook that prints the home view when `DRAFTER_URL` is set, so an agent in the adopting repo opens every session knowing where each open document stands.

## Principles

**Inherited**

- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): the CLI is how the team's agent participates in the record; commit subjects in output let it cite what it did.

**Local**

- **Publishing from the CLI is the LLM loop's output path.** `feedback export` → agent → `versions publish --dispositions` must be a two-command round trip with no manual step in between, or the bulk-rounds promise fails.
