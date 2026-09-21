# API: Admin CLI

An agent-facing command-line tool over `api/admin.md`, built to the AXI conventions (TOON output by default, `--json` for raw, idempotent mutations, stable error codes, a no-argument "home" view). It is called `signatories-axi`.

## Distribution: a skill with the CLI embedded

This is the **primary admin interface** of the system, and it ships as a **skill** in this repository (`skills/signatories-axi/`) whose `scripts/` holds the committed, self-contained bundle built from `packages/cli/` per `axi-skills`. An adopting team installs it into *their* repo (`npx skills add JarvusInnovations/community-drafter --skill signatories-axi`), and their own agent drives documents from there: import invitees from that repo's own gitsheets people sheet, publish revisions its agent drafted, read progress every session. The CLI is not published to npm; the bundle in the skill is the artifact, and a CI drift gate keeps it in sync with the source.

`SKILL.md` opens with a **quickstart written for a person**, not for an agent: sign in, create, publish, open, invite, revise — six numbered steps with the literal commands, plus the one line that says the web console at `<instance>/admin` is where you read what happened. The agent-facing material (TOON, the disposition loop, the session hook, the generated command reference) follows it. A first-time operator who reads only the top of the file can run a document; an agent that reads the whole file loses nothing.

## Configuration

The instance URL and the credential live in `~/.config/signatories/<profile>.toml` (mode 600), written by `signatories-axi login`. `login` takes the instance URL as an argument (`--url https://…`, or `SIGNATORIES_URL` from the environment when the flag is absent) and saves it to the profile alongside the token, so later commands need neither the flag nor the variable. `SIGNATORIES_URL` and `SIGNATORIES_TOKEN` in the environment override the profile for CI and bots. A credential belongs to one hostname (`api/auth.md` § Token shape), so someone who works on two **sites** keeps one profile per site and selects it with `--profile`. The profile is selected by `--profile <name>`, else the `SIGNATORIES_PROFILE` environment variable, else `default`; a bot runs under its own operator by exporting `SIGNATORIES_PROFILE=<bot>` once and never touching the human's default profile. There is no actor label: every write is attributed to the signed-in operator.

**Reading the old location.** The tool was once called `drafter-axi` and kept its profiles in `~/.config/drafter/`. When the selected profile does not exist in `~/.config/signatories/` but does exist under the old path, the old file is read, and the CLI says so once on stderr — where it read from, and that the next `login` will write to the new place. Writes always go to the new directory; nothing is copied or deleted behind the operator's back. The old environment variables `DRAFTER_URL`, `DRAFTER_TOKEN` and `DRAFTER_PROFILE` are still honoured, each only when its `SIGNATORIES_*` counterpart is unset, so a CI job that exported them keeps working. No output ever names the old variables: they are a compatibility surface, not part of the contract.

## Commands

| Command | Does |
| --- | --- |
| `signatories-axi` | home: first the identity line (signed-in operator's email, name and kind, the instance URL, the profile in use), then that operator's documents with phase, next deadline, invited/opened/signed counts, failures; when not signed in, says so and how to `login`; when the stored token is expired or revoked, says that and how to `login` again |
| `login <email> [--url <instance>]` | device-code sign-in against `--url` (or `SIGNATORIES_URL`; refused if neither is given). The URL's hostname picks the **site**, and the resulting token is good on that host only (`specs/behaviors/sites.md`): sends the magic link, prints the user code, waits for approval, then saves the URL, email and 90-day token to the profile |
| `logout` / `whoami` | forget the token / show operator, site and expiry |
| `sites list` | the caller's sites: hostname, name, the From address mail will actually use, operator and document counts, and whether the hostname and the sender are verified yet |
| `sites show <slug>` | one site whole, with the DNS records it still needs |
| `sites create <slug> --hostname … --name … --reply-to … [--sender-name …] [--sender-email …] [--logo-url …] [--accent …]` | create a site (superadmin). Prints the record, then **one block of every DNS record the customer must add**: the CNAME for the hostname (target `sites.signatories.org`), and, with `--sender-email`, the mail provider's DKIM TXT and Return-Path CNAME. It says plainly that creating the record routes nothing — the hostname must also be verified to the project and mapped (`docs/operations.md`) |
| `sites update <slug> [--name …] [--sender-name …] [--sender-email …] [--reply-to …] [--logo-url …] [--accent …]` | change a site's identity (superadmin); `--hostname` is deliberately absent — a site has exactly one hostname, and a new one is a new site |
| `sites remove <slug>` | delete a site (superadmin); refused while any document names it, naming the documents |
| `sites operators <slug>` / `sites operators add <slug> <email>` / `sites operators remove <slug> <email>` | the site's operator group; `remove` drops the email from this site only and says so |
| `operators list` | this site's operator group (not every operator on the instance) |
| `operators add <email> --name … [--kind person\|bot] [--title …] [--org …]` | create |
| `operators update <email> [--name …] [--active true\|false] [--superadmin true\|false] [--title …] [--org …] [--notes …]` | update, deactivate, or (superadmins only) grant or revoke superadmin |
| `operators remove <email>` | remove |
| `docs operators <slug>` / `docs operators add <slug> <email>` / `docs operators remove <slug> <email>` | document membership; `add` draws only from the document's site's operator group and names the site when it refuses |
| `docs create <slug> --title … --audience public\|closed [--site <slug>] [--sender-name …] [--reply-to …] [--addressed-to "…"]… [--capacities personal,official] [--show-signatories list]` | create; the caller becomes the first operator. `--audience` is **required** — who the finished statement is for is not a thing to default into (`specs/data-model.md` § Audience) — and is stored as given, never written to `public_access`. `--addressed-to` names who the statement goes to and is repeatable, once per recipient; it is required with `--audience closed` |
| `docs show <slug>` | dashboard numbers (including how many signatures are behind the current version), the audience and who the statement is addressed to, the **site** and the canonical hostname its personal and public links are built on, versions, schedule |
| `docs open <slug> --comments-close <when> --signing-closes <when>` | open and send invitations, printing how many were delivered and naming any the mailer rejected; `<when>` is ISO 8601 with a zone, or a zone-less time read in the machine's local zone, and the CLI echoes what it resolved to |
| `docs extend <slug> [--comments-close <when>] [--signing-closes <when>]` | extension |
| `docs update <slug> [--audience public\|closed] [--addressed-to "…"]… [--site <slug>]` | change the audience, who the statement is addressed to, and the site, and nothing else (`PATCH /documents/:slug`). `--site` moves the document to another site the caller belongs to: the slug, tokens and history do not change, the hostname its participants are sent to does, and the CLI prints the new canonical host so the operator sees what the next message will say. Passing `--addressed-to` replaces the list; `--audience closed` on a document that would be left with no recipients is refused, naming the flag |
| `docs close | reopen | withdraw <slug> …` | lifecycle |
| `docs export <slug> --pdf [--out <file>] [--paper letter\|a4] [--draft]` | write the deliverable (`specs/screens/deliverable.md`) to a file: the current version's text, its title block, and the signatory list as it stands. `--pdf` names the format and is the only one today. Without `--out` the file is `<slug>-v<n>.pdf` in the working directory, or `<slug>-v<n>-draft.pdf` while the deliverable is still the watermarked form; the command prints the path it wrote, the version, the paper, the size, and whether the copy is a draft or clean — and nothing about who signed, because the counts belong to `signatures list` and a second request to fetch them could only report a moment other than the one the file was rendered at. `--draft` forces the watermarked form of a document that has already gone clean; there is no flag the other way |
| `versions list <slug>` / `versions show <slug> <n> [--body]` | read |
| `versions publish <slug> --file new.md --summary "…" [--notes-file …] [--final] [--dispositions d.json]` | publish: one commit whose trailers carry the summary; prints version number, commit subject, notification counts, and `signing_closes_at` only when the publish moved it (a `null` line reads as a deadline that was cleared) |
| `versions compare <slug> <from> <to> [--unchanged]` | text redline for a terminal |
| `people import <slug> [file.ndjson \| -] [--suggested-capacity official] [--update] [--dry-run]` | import invitees; accepts a gitsheets people sheet's NDJSON export directly. People are merged by email **within the document's site**, and each row's sign-card values become that document's own prefill, so an import never changes what another document offers. Without `--update` an existing person keeps every field they already have and only their blanks are filled; `--update` lets the file replace them and refresh an already-invited person's prefill. `--dry-run` shows what each row would change and what it would keep, in whichever mode, without writing |
| `people remove <slug> <person>` | remove a staged invitation that was never sent |
| `people list <slug> [--status not_sent\|signed\|…] [--source crm] [-q name]` | statuses (staged invitations read `not_sent`), no tokens. The `name` and `org` columns are what **this document's** sign card prefills for each person — the participation's own prefill where it has one, else the person's site-level default — not the raw contact record |
| `people links <slug> [--person a,b] [--out links.csv]` | export personal links (recorded); `--out` writes the file `0600`, as `login` does for the profile — the rows are credentials |
| `people send <slug> [--only-unsent] [--person a,b] [--dry-run]` | send invitations; prints how many were delivered, how many failed and who with what error; `--dry-run` lists who would receive one and who is skipped and why |
| `people remind <slug> --target unopened\|opened-not-acted [--min-age <hours>] [--dry-run]` | reminders; skips anyone this document messaged within `--min-age` hours (default 48, `0` to send regardless) and prints what it actually sent, how many were skipped as recently messaged and how many by preference |
| `people revoke-link | reissue-link <slug> <person>` | link management |
| `people expire <slug> <person> --expires-at <when>` | set when one person's link stops working. `<when>` takes the same grammar as `docs open` — ISO 8601 with a zone, or a zone-less time read in the machine's local zone — and the CLI echoes what it resolved to, so an expiry is never a hand-written UTC guess |
| `signatures list <slug> [--include-revoked] [--conditional]` | signatures, each with the version it is attached to and whether it is behind the current version |
| `signatures revoke <slug> <person> --reason "…"` | admin revocation |
| `submissions list <slug> [--pending] [--version n] [--person p] [--include-drafts]` | whole submissions, each with its comments; drafts only on request and always labeled |
| `feedback export <slug> [--format json\|md] [--out …]` | the LLM-round bundle |
| `notifications list <slug> --status failed` / `notifications retry <slug>` | health; `list` also prints when the last operator digest went out for this document, or that none has (`behaviors/notifications.md` § Operator digest) |
| `init-data-repo` | first-boot helper |

## Output rules

- Every mutation prints the resulting record's key fields and the commit subject.
- `people list` and `docs show` never print tokens or emails unless `--contacts` is passed (emails only, still never tokens).
- **Every document view prints `audience`** — `public` or `closed` — and, whenever recipients are named, `addressed_to`, both as stored. They sit beside `public_access` in the same object, because an operator reading a document needs to see at a glance that who the statement goes to and who may read the draft are two different answers (`specs/data-model.md` § Audience). A document stored without `audience` prints `closed`.
- **Every document view prints `site`** — the slug, `default` for a document that names none — and the canonical host its links are built on, because an operator handing out a link needs to read the address their participants will actually receive, not assemble it from the URL they happen to be signed in to (`specs/behaviors/sites.md`).
- **`docs create`, `docs show` and `docs open` print `public_url`** — `https://<the document's site hostname>/d/<slug>` — whenever the document's `public_access` is not `none`, so the address an operator hands to their own site or newsletter never has to be guessed or assembled by hand. A document with `public_access: none` prints no such field.
- **`people import` names the site it merged into.** An email is unique within a site and not across the instance (`specs/behaviors/sites.md` § People are per site), so the one command that matches people by email says which site's people it matched against, beside the counts. `people list` needs no such line: its `name` and `org` are already this document's own resolved values, and `docs show` is where an operator reads the site.
- **`docs export` never writes a PDF to stdout.** It is the one command whose payload is binary; it always lands in a file, and what the terminal gets is the path and what was put there. An operator who wants to read the document opens the file.
- Errors map API `error` codes to exit codes: 2 validation, 3 phase/conflict, 4 not found, 5 auth, 1 other; the message is the API's `message`.
- The home view includes `help[]` lines suggesting the next likely command, per AXI.
- **One invocation form per surface.** Everything the CLI itself emits — `help[]` hints, error suggestions, hook output, `--help` usage lines — writes commands as `signatories-axi <command> …`, never a resolved path. The resolved path of the bundled shim (which is not on `PATH`) appears exactly once, as the home view's `invoke_as` field, which is where a reader learns how to turn those hints into a runnable command. `SKILL.md` is the other surface and uses `scripts/signatories-axi` throughout, stated once at its top; within either surface the form never varies.

## Help

`--help` on a command is the command's whole contract, because an agent (or a first-time operator) will not read the spec:

- **`people import --help`** lists the row fields by their exact names — `email` and `name` required; `phone`, `org`, `role`, `descriptor`, `external_id`, `suggested_capacity`, `tags` optional — says that any other key is ignored (so `organization` or `title` silently does nothing), says in one line that people are matched by email within this document's site and that an existing person's filled-in fields are kept unless `--update` is passed, and points at `--dry-run` as the way to see what a file would do before it writes.
- **`versions publish --help`** lists the four disposition outcomes with one line each: `accepted` (incorporated), `partial` (partly addressed, note expected), `declined` (not incorporated, note required), `noted` (read and noted, no text change) — per `behaviors/review-and-judgement.md`. An `outcome` outside that set is a validation error, never a silent pass.

## Session hook

Per `axi-skills`, the skill ships a SessionStart hook that prints the home view when `SIGNATORIES_URL` is set, so an agent in the adopting repo opens every session knowing where each open document stands. The home view's identity line names the site the profile is signed in to, since the same command against two profiles is two different tenants.

`SKILL.md` carries a **Sites** section: what a site is in one paragraph, the four onboarding steps in order (verify, map, point DNS, create the record), the `sites` commands, and the warning that the record routes nothing on its own.

## Principles

**Inherited**

- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): the CLI is how the team's agent participates in the record; commit subjects in output let it cite what it did.

**Local**

- **Publishing from the CLI is the LLM loop's output path.** `feedback export` → agent → `versions publish --dispositions` must be a two-command round trip with no manual step in between, or the bulk-rounds promise fails.
