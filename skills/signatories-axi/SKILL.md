---
name: signatories-axi
description: Drive a Signatories document from the shell — sign in, create a document, publish revisions, invite and track signers, export the pending-feedback bundle for an LLM disposition round, and check in on every open document at the start of a session. Use whenever a task involves a Signatories admin API instance (SIGNATORIES_URL/SIGNATORIES_TOKEN, or `login`), a document slug, invitations, signatures, or publishing a version.
metadata:
  internal: false
---

# signatories-axi

An agent-facing CLI over the Signatories admin API (`specs/api/admin.md`), built to the
[AXI](https://github.com/kunchenguid/axi) conventions: TOON output by default, `--json` for raw,
idempotent mutations, stable exit codes, and a no-argument "home" view showing every open
document's status. This is the **primary admin interface** to a Signatories instance — an
adopting team installs this skill into their own repo and drives documents from there: importing
invitees from that repo's own people sheet, publishing revisions their agent drafted, and reading
progress every session.

The bundled CLI is **not on PATH**. Always invoke it as `scripts/signatories-axi <command>` from this
skill's directory — never `node scripts/signatories-axi` (it's a bash shim, not a Node script) and
never a bare `signatories-axi` (that assumes a global install this skill doesn't provide). If output
elsewhere shows a follow-up command starting with `signatories-axi`, run it as
`scripts/signatories-axi …` instead.

## Quickstart (for a person)

Six steps take a document from nothing to signatures. Run them from this skill's directory;
`<instance>` is the address of the Signatories deployment your group uses, and
`<slug>` is a short name you pick for the document (`board-letter`, `charter-2026`).

1. **Sign in.** `scripts/signatories-axi login you@example.org --url https://<instance>` prints an
   8-character code and waits. Open the link that lands in your inbox, check the code on the
   page matches the one in your terminal, and click Approve. That is the only sign-in there is —
   no password, and the token lasts 90 days.
2. **Create the document.**
   `scripts/signatories-axi docs create <slug> --title "Our statement" --sender-name "Our Coalition" --reply-to you@example.org`
   You become its first operator. Nothing is visible to anyone yet.
3. **Publish the text.** Write the statement as Markdown in a file, then
   `scripts/signatories-axi versions publish <slug> --file draft.md --summary "Initial draft"`.
   Every later revision is another `versions publish` with its own one-line summary.
4. **Open it on a clock.**
   `scripts/signatories-axi docs open <slug> --comments-close 2026-10-01T17:00 --signing-closes 2026-10-08T17:00`
   Give a zone (`…Z`, `…-04:00`) or a zone-less time, which is read in this machine's local
   zone; the command echoes what it resolved to, so check that line before walking away.
5. **Invite people.** Put one JSON object per line in a file — `{"email": "...", "name": "..."}`,
   plus optional `org`, `role`, `descriptor`, `suggested_capacity` — then
   `scripts/signatories-axi people import <slug> invitees.ndjson --dry-run` to see what it would do,
   and again without `--dry-run` to write it. `scripts/signatories-axi people send <slug>` mails each
   person their own link and prints how many went out; anyone the mail provider rejected is named
   with the reason and stays `not_sent`, so fix the address and run `people send` again.
   Run `people import --help` for the full field list.
6. **Revise.** `scripts/signatories-axi feedback export <slug> --format md` gives you every pending
   comment. Answer them by publishing again with a dispositions file, where each comment gets one
   of four outcomes — `accepted`, `partial`, `declined`, `noted`:
   `scripts/signatories-axi versions publish <slug> --file v2.md --summary "…" --dispositions d.json`.

**There is also a web console.** Sign in at `https://<instance>/admin` with the same email address
and you get a read view of everything above: progress and deadlines, the people you invited and
where each one stands, submissions and their comments, versions, and "view as" — the exact page a
given person was sent. Writing still happens here, on the command line.

Check on things any time with `scripts/signatories-axi` alone (every document, with counts) or
`scripts/signatories-axi docs show <slug>`.

## Configuration

Run `scripts/signatories-axi login you@example.org --url https://drafts.example.org` once: it sends a
sign-in link to that address, prints an 8-character code, and waits for a human (you, or the
mailbox owner for a bot operator) to open the link and approve the device. On approval it writes
the instance URL, the operator's email, and a 90-day token to `~/.config/signatories/<profile>.toml`
(mode 600) — every later command reads from there, and the CLI refreshes the token silently once
it's more than 30 days old. Select a non-default profile with `--profile <name>`.

```sh
scripts/signatories-axi login you@example.org --url https://drafts.example.org
scripts/signatories-axi
```

For CI or a bot with no profile file, set `SIGNATORIES_URL` and `SIGNATORIES_TOKEN` in the environment
instead — either overrides the profile independently. There is no actor label any more: every
write is attributed to the signed-in operator. `scripts/signatories-axi whoami` shows who that is and
when the token expires; `scripts/signatories-axi logout` forgets it.

**Coming from `drafter-axi`.** The tool used to be called that and kept profiles in
`~/.config/drafter/`. A profile still sitting there is read when `~/.config/signatories/` has
none for the selected name, and the CLI says so once on stderr; the next `login` writes to the
new place. `DRAFTER_URL`, `DRAFTER_TOKEN` and `DRAFTER_PROFILE` are still honoured, each only
when its `SIGNATORIES_*` counterpart is unset.

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

## Sites

One deployment answers on many hostnames. A **site** is one hostname and the identity carried on
it: a name, a sender, an optional logo and accent, and the group of operators who work there.
Every document belongs to exactly one site, and every page, link and message that document shows a
participant carries that site's identity and no other — the name in the top bar, the From line,
the Reply-To, and the hostname in every link. A document that names no site belongs to the
deployment's own default site, which is what every document created before sites existed reads as.

Onboarding a hostname is four steps, in order, and only the last one is data:

1. **Verify the domain to the project** — the customer adds the verification record the cloud
   provider prints, or the platform team verifies the domain itself. Nothing can be mapped before
   this.
2. **Map the hostname** — the platform team adds it to the deployment's list of site hostnames and
   applies (infrastructure, not this CLI).
3. **Point DNS at the service** — the customer adds a `CNAME` to `sites.signatories.org`. The
   certificate provisions on its own once the record resolves.
4. **Create the site record** — `scripts/signatories-axi sites create …`, which prints every DNS record
   the customer still has to add: the CNAME above, and, when `--sender-email` is given, the mail
   provider's DKIM and Return-Path records (take those two values from the Postmark console).

**Creating the record routes nothing.** A site record is an identity for a hostname someone else
has already routed; nothing in this CLI or the API creates, changes or checks a DNS record, a
domain mapping or a certificate. `sites list` and `sites show` report whether a hostname has
actually answered a request here and whether the mail provider has accepted the site's sender —
observations, never promises.

Mail follows the site: a site with a verified `--sender-email` sends **From** it; a site without
one sends from the platform's own verified address under the site's name. A sender the provider
has not accepted yet **fails per recipient** rather than quietly going out under someone else's
address, so leave `--sender-email` off until verification is done.

Creating a site, changing its identity and deleting it are superadmin actions. Managing a site's
operator group is not — any operator of the site may add or remove members of it, and
`sites operators remove` drops the email from that site only, leaving the record and every other
membership intact.

Assign documents with `docs create <slug> --site <site> …` or `docs update <slug> --site <site>`.
A credential belongs to one hostname, so someone who works on two sites signs in twice and keeps
one profile per site (`--profile`).

## Session hook

`scripts/signatories-axi hook install` (run once, from a repo that has installed this skill) writes a
SessionStart hook to `.claude/settings.json` that prints the documents dashboard — phase, next
deadline, invited/opened/signed counts, notification failures — at the start of every agent session
in that repo, but only when `SIGNATORIES_URL` is set; it stays silent otherwise. Default scope is
`project` (committed, portable across contributors); pass `--scope global` for a single operator's
every-session use instead.

## Commands

<!-- BEGIN GENERATED: command-reference -->

### Session

- `scripts/signatories-axi login <email> [--url <instance>]` — Device-code sign-in: the URL's hostname picks the site, and the resulting token is good on that host only. Emails a magic link, prints a code to approve, then waits and saves a 90-day token to the profile.
- `scripts/signatories-axi logout` — Forget the stored token for this profile.
- `scripts/signatories-axi whoami` — Show the signed-in operator, the site this credential belongs to, and the token expiry.

### Sites

- `scripts/signatories-axi sites list` — The caller's sites: hostname, name, the From address mail will actually use, operator and document counts, and whether the hostname and the sender are verified yet.
- `scripts/signatories-axi sites show <slug>` — One site whole, with the DNS records it still needs.
- `scripts/signatories-axi sites create <slug> --hostname <host> --name "<text>" --reply-to <email> [--sender-name "<text>"] [--sender-email <email>] [--logo-url <https url>] [--accent <#rrggbb>]` — Create a site (superadmin). Prints the record, then every DNS record the customer must add — the CNAME for the hostname and, with --sender-email, the mail provider's DKIM and Return-Path records — and says plainly that creating the record routes nothing.
- `scripts/signatories-axi sites update <slug> [--name "<text>"] [--reply-to <email>] [--sender-name "<text>"] [--sender-email <email>] [--logo-url <https url>] [--accent <#rrggbb>]` — Change a site's identity (superadmin); --hostname is deliberately absent — a site has exactly one hostname, and a new one is a new site.
- `scripts/signatories-axi sites remove <slug>` — Delete a site (superadmin); refused while any document names it, naming the documents.
- `scripts/signatories-axi sites operators <slug> | sites operators add <slug> <email> | sites operators remove <slug> <email>` — The site's operator group; any operator of the site may change it, and remove drops the email from this site only.

### Operators

- `scripts/signatories-axi operators list` — This site's operator group — not every operator on the instance.
- `scripts/signatories-axi operators add <email> --name "<text>" [--kind person|bot] [--title "<text>"] [--org "<text>"]` — Create an operator.
- `scripts/signatories-axi operators update <email> [--name "<text>"] [--active true|false] [--superadmin true|false] [--title "<text>"] [--org "<text>"] [--notes "<text>"]` — Update or deactivate an operator; --superadmin is grantable only by another superadmin.
- `scripts/signatories-axi operators remove <email>` — Delete an operator record outright (superadmin): removes them from every site and document. To take someone off one site, use `sites operators remove`.

### Documents

- `scripts/signatories-axi docs create <slug> --title "<text>" --audience public|closed [--site <slug>] [--sender-name "<text>"] [--reply-to <email>] [--addressed-to "<name>"]... [--capacities personal,official] [--show-signatories list|count|none] [--revocation-window-hours <n>] [--tags a,b]` — Create a document in draft; the caller becomes its first operator. --site names the site it belongs to (default: the site this profile is signed in to), which decides the hostname its links and mail are built on; --sender-name and --reply-to fall back to the site's. --audience is required and says who the finished statement is for: public (published for anyone to read) or closed (delivered to the people and bodies it is addressed to). --addressed-to names one recipient and repeats; it is required with --audience closed. Neither touches --public, which is whether anyone with the link may read the working draft.
- `scripts/signatories-axi docs show <slug>` — Dashboard numbers, versions, and schedule; prints the site and the canonical host its links are built on, the audience, who the statement is addressed to, and public_url when the document is publicly readable.
- `scripts/signatories-axi docs update <slug> [--audience public|closed] [--addressed-to "<name>"]... [--site <slug>]` — Change the audience, who the statement is addressed to, and the site, and nothing else. --site moves the document to another site you operate: the slug, tokens and history do not change, the hostname its participants are sent to does. --addressed-to replaces the recipients.
- `scripts/signatories-axi docs open <slug> --comments-close <iso> --signing-closes <iso>` — Open commenting and signing, and send invitations.
- `scripts/signatories-axi docs extend <slug> [--comments-close <iso>] [--signing-closes <iso>]` — Push a deadline later (never earlier).
- `scripts/signatories-axi docs close <slug>` — Close signing now.
- `scripts/signatories-axi docs reopen <slug> [--comments-close <iso>] --signing-closes <iso>` — Reopen a closed document.
- `scripts/signatories-axi docs withdraw <slug> --reason "<text>" [--public]` — Withdraw the document.
- `scripts/signatories-axi docs operators <slug>` — List a document's operators.
- `scripts/signatories-axi docs operators add <slug> <email>` — Add an operator to a document, drawing only from the document's site's operator group.
- `scripts/signatories-axi docs operators remove <slug> <email>` — Remove an operator from a document (refused for the last one).

### Versions

- `scripts/signatories-axi versions list <slug>` — Every published version, newest last.
- `scripts/signatories-axi versions show <slug> <n> [--body]` — One version, with dispositions.
- `scripts/signatories-axi versions publish <slug> --file <path> --summary "<text>" [--notes-file <path>] [--final] [--dispositions <file.json>]` — Publish a new version in one commit; prints the version number, commit subject, and notification counts. A --dispositions entry's outcome is one of accepted, partial, declined or noted.
- `scripts/signatories-axi versions compare <slug> <from> <to> [--unchanged]` — A text redline between two versions.

### People

- `scripts/signatories-axi people import <slug> [<file.ndjson>|-] [--suggested-capacity personal|official] [--dry-run]` — Import invitees from NDJSON or a JSON array (a gitsheets people export works directly); rows carry email and name plus optional org, role, phone, descriptor, external_id, suggested_capacity and tags, and --dry-run shows what each row would do first. Run `people import --help` for the full field list.
- `scripts/signatories-axi people list <slug> [--status <status>] [--source <source>] [-q <text>] [--contacts]` — Participation statuses — never tokens; emails only with --contacts.
- `scripts/signatories-axi people links <slug> [--person a,b] [--out <file.csv>]` — Export personal sign-in links (recorded).
- `scripts/signatories-axi people remove <slug> <person>` — Take back a staged invitation that was never sent.
- `scripts/signatories-axi people send <slug> [--only-unsent] [--person a,b] [--dry-run]` — Send invitations, reporting what was delivered and what the mailer rejected; --dry-run lists who would receive one and who is skipped and why.
- `scripts/signatories-axi people remind <slug> --target unopened|opened-not-acted [--min-age <hours>] [--dry-run]` — Send reminders to a target segment, skipping anyone messaged within --min-age hours (default 48; 0 sends regardless).
- `scripts/signatories-axi people revoke-link <slug> <person>` — Revoke one person's link.
- `scripts/signatories-axi people reissue-link <slug> <person>` — Reissue one person's link (prints it once).
- `scripts/signatories-axi people expire <slug> <person> --expires-at <when>` — Set when one person's link stops working; <when> takes the same grammar as docs open (ISO 8601 with a zone, or a zone-less time read locally) and the resolved instant is printed back.

### Signatures

- `scripts/signatories-axi signatures list <slug> [--include-revoked] [--conditional]` — Every signature, with its version, sign/revoke dates and whether it is behind.
- `scripts/signatories-axi signatures revoke <slug> <person> --reason "<text>"` — Admin revocation of a signature.

### Submissions and feedback

- `scripts/signatories-axi submissions list <slug> [--pending] [--version <n>] [--person <id>] [--include-drafts]` — Whole submissions with their comments; drafts only on request, and always labeled.
- `scripts/signatories-axi feedback export <slug> [--format json|md] [--out <file>]` — The LLM-round bundle — pipe straight into `versions publish --dispositions`.

### Notifications

- `scripts/signatories-axi notifications list <slug>` — Sent, pending and failed counts, and the last operator digest.
- `scripts/signatories-axi notifications retry <slug> [--event <name>] [--person <id>]` — Re-dispatch anything not yet notified.

### Instance

- `scripts/signatories-axi init-data-repo` — First-boot helper: write sheet configs into an empty data repo.

### Session

- `scripts/signatories-axi hook install [--scope project|global] [--dir <path>] | hook status | hook uninstall [--scope project|global]` — Manage the SessionStart hook that prints the home view (documents, deadlines, funnel counts) at the start of every agent session.

<!-- END GENERATED: command-reference -->
