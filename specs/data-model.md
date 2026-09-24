# Data Model

All durable state is a set of **gitsheets** sheets in the data repository, and **git is the data model**: a record holds the *current* state of one thing, and everything about *when* and *why* it changed lives in the commit history. The tree is flat and semantic: paths name things (a document, a person, a submission), never moments, statuses or versions. There are no history tables, no version tables, no event logs. To answer a time question, read `git log`.

Field names below are the on-record names. Timestamps are ISO 8601 UTC. Identifiers are lowercase slugs unless stated.

## Sheets

| Sheet | Path template | Format | One record per |
| --- | --- | --- | --- |
| `documents` | `${{ slug }}` | markdown | document: settings in frontmatter, **the text as the body**; the body's history is the version history |
| `people` | `${{ site }}/${{ id }}` | TOML | person known to **one site** (`behaviors/sites.md`); two sites may hold the same email as two independent records |
| `participations` | `${{ document }}/${{ person }}` | TOML | one person's relationship to one document: link, tracking, preferences, signature |
| `submissions` | `${{ document }}/${{ id }}` | TOML | one person's set of comments against one version, from first save through submission and disposition |
| `operators` | `${{ id }}` | TOML | one person or bot allowed to run documents |
| `sites` | `${{ slug }}` | TOML | one hostname the deployment answers on, and the identity it carries (`behaviors/sites.md`) |

Six sheets. Cross-references are by slug so records read sensibly in a file browser.

## Commits are the events

Every mutation is one `repo.transact` commit. The subject is a human sentence; the **trailers carry the structured data** an agent or a dashboard reads back.

| Trailer | Values | On |
| --- | --- | --- |
| `Action` | `create`, `settings`, `open`, `extend`, `close`, `reopen`, `withdraw`, `publish`, `invite`, `send`, `confirm-call`, `deliver`, `sign`, `resign`, `revoke`, `comment`, `submit`, `prefs`, `track`, `admin-revoke`, `link-revoke`, `link-reissue`, `link-export`, `link-expire`, `uninvite`, `operator-add`, `operator-update`, `operator-remove`, `doc-operator-add`, `doc-operator-remove`, `site-create`, `site-update`, `site-remove`, `site-operator-add`, `site-operator-remove`, `migrate` | every commit |
| `Document` | slug | every commit about a document |
| `Site` | slug | every commit about a site, and every commit about a document that belongs to one |
| `Person` | slug | every commit about a person's action |
| `Actor` | an operator's email, `participant`, or `system` (bootstrap) | every commit |
| `Version` | integer | `publish` (the number this commit becomes), `submit`, `comment`, `sign` (the version seen) |
| `Summary` | 1–200 chars | `publish` (the one-line changelog) |
| `Final` | `true` | written by earlier builds on a `publish` declared final; no longer written, and ignored when read |
| `Notes` | text | `publish` (team-facing) |
| `Submission` | submission id | `comment`, `submit` |
| `Judgement` | `sign` \| `sign_conditional` \| `comment` \| `decline` | `submit` |
| `Disposed` | comma-separated `<submission>:<comment>` refs | `publish` |
| `Signature` | `sign` \| `resign` \| `revoke` | `submit` when the same commit also writes the participation's `signature` table |
| `Deadlines` | comma-separated `<field> <from> -> <to>`, ISO 8601 UTC, `(unset)` where there was no previous value | `extend`, `reopen` |
| `Opened` | comma-separated person slugs | `track`, naming the people whose **first** open this commit recorded; a `track` commit that only bumped `last_seen_at` and `opens` carries none |
| `Reason` | text | `revoke`, `withdraw`, `admin-revoke`, and `submit` with `decline` |
| `Request-Id` | id | every commit from a request |

`migrate` is the one action no operator can ask for: a boot-time, idempotent rewrite the service performs on itself when it finds records in a layout an earlier build wrote. It is always attributed to `system`, always one commit, and always a no-op on the next boot.

A `confirm-call` commit records one confirm-call: it patches the `notified` table of every signer the call reached (`notified."confirm-call-<ts>"`), names how many in its subject (`confirm-call: coalition-charter (4 signers)`), and is written after delivery, like any send batch; a call that reached nobody writes no commit. A `deliver` commit sets `delivered_at` (and `delivered_note`) on the document; the signers the `delivered` message then reached are marked `notified.delivered` in the ordinary send commit that follows it.

A `track` commit is per document, like every other commit, so the opens it records belong to one document's history. Subjects look like `sign: jane-doe on coalition-charter`, `publish: coalition-charter v3`, `submit: jane-doe on coalition-charter v2 (sign_conditional)`, `comment: jane-doe on coalition-charter (jane-doe-k7q2)`, `extend: coalition-charter signing to 2026-09-30T21:00Z`.

The dashboard's recent activity, a person's history, the version list and "how was this statement approved" are all `git log` queries filtered by trailer. Nothing duplicates them into records.

## `documents`

One markdown record per document. Frontmatter is the settings; the body is the current text.

| Field | Type | Notes |
| --- | --- | --- |
| `slug` | string, `^[a-z0-9][a-z0-9-]{1,60}$` | identity; never changes |
| `title` | string | display title (independent of any heading in the body) |
| `state` | enum `draft` \| `open` \| `closed` \| `withdrawn` | phases within `open` derive from the clock (`behaviors/document-lifecycle.md`) |
| `opened_at`, `comments_close_at`, `signing_closes_at` | timestamp? | |
| `revocation_window_hours` | integer, default 72 | |
| `capacities` | array of `personal` \| `official`, default both | |
| `audience` | enum `public` \| `closed` | who the **finished** statement is for (below); absent only on a record written before the field existed, which reads as `closed` |
| `addressed_to` | array of string | who the finished statement is published or delivered to — a council, a board, an organization; required when `audience = closed` (below) |
| `public_access` | enum `none` \| `read` \| `participate`, default `none` | **drafting-time** read access: whether anyone holding the link may read the working document; independent of `audience` (below); `participate` is **[phase 2]** |
| `show_signatories` | enum `list` \| `count` \| `none`, default `list` | |
| `site` | slug? | the site this document belongs to (`behaviors/sites.md`); absent = the default site, which is what every document written before the field existed reads as. It is the hostname every personal link, public link and message for this document is built on |
| `created_by` | email | the operator who created the document; always also in `operators` |
| `operators` | array of email | current operators of this document; never empty |
| `operator_notified` | table? of event → value | the operator messages this document has already produced (`behaviors/notifications.md` § Operator digest): `digest` is the last date an operator digest was delivered (`YYYY-MM-DD` in the instance time zone), `first_signature` the timestamp that once-per-document notice went out (`first_comment`, written by earlier builds, is ignored). Written only after delivery, and never about a participant; absent on a document no operator message has been sent for |
| `sender_name`, `reply_to` | string | |
| `withdraw_reason`, `withdraw_public` | string?, boolean | |
| `delivered_at` | timestamp? | when an operator recorded that the statement was delivered (`behaviors/signatures.md` § Delivery); set once, never cleared. Absent = not delivered |
| `delivered_note` | string? | the operator's note on the delivery, shown to signers |
| `tags` | array of string | |
| `body` | markdown | the text |

The sheet's format sets `body = 'body'` and does not set `title`, so the body may or may not begin with a heading; `title` is a plain setting.

### Audience

Every document declares, before anyone is invited, **who the finished statement is for**: `public` — it will be published for anyone to read — or `closed` — it is delivered to the people and bodies it is addressed to, and to no one else. It is the thing a signer is told before they sign (`screens/document.md` § Display Rules 3), because it is who they will be standing in front of once their name is on it.

`audience` is **stored on the document**. It is not derived from `public_access`, and the two answer different questions:

- **`audience` is a property of the statement** — who the finished text and its signatory list will be published or delivered to.
- **`public_access` is a property of the drafting process** — whether anyone holding the link may read the *working* document while it is being drafted (`screens/public-and-embed.md`).

The two are orthogonal, and all four combinations are meaningful:

| `audience` | `public_access` | Means |
| --- | --- | --- |
| `public` | `none` | a public statement drafted in private: only invitees see the draft, and the finished statement is published |
| `public` | `read`, `participate` | a public statement drafted in the open |
| `closed` | `none` | a letter to a named body, drafted among its invitees |
| `closed` | `read`, `participate` | a letter to a named body whose draft anyone with the link may read |

A signer is told the audience, never the drafting access: "anyone with this link can read the draft" is not what they are being asked to stand behind.

`addressed_to` names who the finished statement goes to — a council, a board, an organization. It is **required when `audience = closed`**: a closed statement that names no recipient tells a signer nothing about who will read their name. It is also allowed on a `public` document, where it says who the published statement is addressed to even though anyone may read it.

`addressed_to` is a **disclosure**, not an access control: phase 1 has no sign-in for an organization, and nothing in this field lets anyone new open the document.

A document written before `audience` existed carries no value for it, and reads as `closed` with no `addressed_to` until an operator sets one (`api/admin-cli.md` → `docs update`). `closed` is the undeclared state: nothing is published for anyone to read until someone says so. An operator sets the audience before anyone is invited, so only pre-field records are ever read this way.

`show_signatories` is the separate question of whether the *signatory list* is shown at all, and it is orthogonal to both: a `public` document may show only counts, and a `closed` one may show a full list to its invitees.

### Versions

A **version** is a commit in the record's history **in which the body changed**. Settings-only commits (`Action: settings`, `extend`, `open` …) are not versions. Nothing about a version is stored; all of it derives:

| Version attribute | Derived from |
| --- | --- |
| `number` | position among body-changing commits, oldest = 1 |
| `commit` | the hash (internal; never shown to participants) |
| `summary` | the `Summary` trailer, else the subject with any `publish: <slug> v<n>` prefix removed |
| `published_at` | committer date |
| `published_by` | `Actor` trailer, else author name |
| `notes` | `Notes` trailer |
| `body` | the record's body at that commit |

Numbering is stable because the branch forbids force-pushes. The read model walks `git log --first-parent` over the record at boot, compares body content between adjacent commits, indexes the versions, and appends on publish. A publish commit may also change settings (a publish during the signing phase extends `signing_closes_at` in the same commit) and may set dispositions on submissions (`Disposed` trailer), so the commit that *is* the version carries the answers it gave.

## `operators`

One record per person or bot allowed to run documents (`behaviors/operators.md`). Managed only through the admin API and CLI, so the service stays the single writer.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | slug | derived from the email's local part, disambiguated on creation; the path |
| `email` | string, email | merge key, lowercase; indexed |
| `name` | string | |
| `kind` | enum `person` \| `bot` | bots are unattended agents with their own mailbox |
| `active` | boolean | false = no access anywhere, at the next request |
| `title`, `org` | string? | |
| `notes` | string? | team-facing |
| `superadmin` | boolean? | sees and may act on every document (`behaviors/operators.md` § Superadmins); set only by another superadmin or by editing the record in the data repo |

Who added or deactivated an operator and when is the history of the record (`operator-add`, `operator-update`, `operator-remove` commits with the acting operator's email as `Actor`).

**An operator record is instance-wide; membership is not.** There is one record per email however many sites the person works on. Which operators a given operator can see, add to a document, or edit is the **site's operator group** — the `operators` list on the `sites` record, mirroring `documents.operators` one level up (`behaviors/sites.md` § Operators and tenancy). Nothing about a group is stored on the operator record, so a person joins or leaves a site without their record changing.

## `sites`

One record per hostname (`behaviors/sites.md`). The **default site is not a record**: it is derived from the deployment's configuration and owns every document with no `site`, so an instance that has never created a site has an empty sheet and behaves as it does today.

| Field | Type | Notes |
| --- | --- | --- |
| `slug` | slug | identity; the path; `default` is reserved for the deployment's own site |
| `hostname` | host name | lowercase, no scheme, port or path; unique across sites |
| `name` | string | what the top bar, the footer and every message call this site |
| `sender_name` | string? | default mail display name for this site's documents; a document's own `sender_name` wins |
| `sender_email` | email? | the `From` address, when verified with the mail provider; absent = the platform's own verified address (`behaviors/sites.md` § Mail) |
| `reply_to` | email | default Reply-To for this site's documents; a document's own `reply_to` wins |
| `logo_url` | https URL? | web surfaces only; messages carry no logo on any site |
| `accent` | color token? | overrides the accent color of `screens/document.md` § Design and nothing else |
| `operators` | array of email | the site's operator group; never empty |
| `created_by` | email | the operator who created the site |

Who created, changed or deleted a site is the history of the record (`site-create`, `site-update`, `site-remove`, `site-operator-add`, `site-operator-remove`, each with a `Site` trailer). Hostname routing, certificates and DNS are not fields and not records: they live in `tf/` and in the customer's DNS zone (`behaviors/sites.md` § What a site is not).

## `people`

One record per person **per site**. The path is `${{ site }}/${{ id }}`, so `people/default/jane-doe.toml` and `people/river-alliance/jane-doe.toml` are two independent people who may carry the same email address and know nothing of each other.

| Field | Type | Notes |
| --- | --- | --- |
| `site` | slug | the site this person belongs to, and the first path component; `default` for the derived default site (`behaviors/sites.md` § The default site) |
| `id` | slug | identity **within the site**; stable across that site's documents. Two sites may each have a `jane-doe` |
| `name` | string | default signature name |
| `email` | string, email | merge key on import, within the site |
| `phone` | string? | E.164; **[phase 2]** SMS |
| `org`, `role`, `descriptor` | string? | the site-level defaults for the sign card |
| `source` | string | `crm`, `public`, `admin` |
| `external_id` | string? | id in the adopting team's own CRM |

Never rendered on any participant or public surface, beyond the sign-card prefill resolved below.

### A person belongs to a site; a per-document prefill belongs to the participation

A person record is **shared by every document on its site** and by none outside it. Two facts decided this (issue #51, from the 2026-09-20 simulated run, where an import on one document silently rewrote another document's signer and the unrelated document's sign card then offered them the wrong organization):

- **The site is the tenancy boundary**, so it is the only boundary a contact list can safely have. An instance-wide `people` sheet makes one coalition's import edit another coalition's contact; a per-document sheet makes the same person four records on four documents of the same campaign, and every correction has to be made four times. The site is the unit that already means "one team's data" everywhere else in this model (`behaviors/sites.md` § Operators and tenancy), and it is the right unit here.
- **A default and an override are different facts.** `name`, `org`, `role` and `descriptor` on the person are what this team usually calls them — the fallback for any document on the site. What a *particular* statement should prefill is a fact about that statement: the same person signs one letter as a parent and another as a board chair. That belongs on the `participations` record, where it cannot reach a second document.

So the sign card's fields resolve in one direction, field by field, with no merging of the two into a third thing:

1. the participation's `prefill` value for that field, if it has one;
2. else the person's site-level default;
3. else nothing — an empty box the signer fills in.

An import writes the row's values into the participation's `prefill` for the document it is importing into, which is why a second document's import can no longer change what the first one prefills. The signature itself is still whatever the signer typed; neither the person nor the prefill is written from a signature (`behaviors/signatures.md`).

### Migrating the pre-site layout

Records written before people had a site live at `people/<id>.toml`, one level above the path template, where nothing reads them. They all belong to the default site: an instance could not have had a second site's people, because a person was instance-wide.

The service migrates them itself, at boot, in **one commit** (`Action: migrate`, `Actor: system`): every record directly under `people/` is rewritten at `people/default/<id>.toml` with `site = 'default'` and removed from the old path. It runs only when the old layout is found, so the next boot is a no-op and running it twice writes nothing. `participations` need no migration: they name a person by slug, and the person's site is the document's site.


## `participations`

One record per person per document, created by an invitation. Current state only; the story is in `git log` on the `Person` and `Document` trailers.

| Field | Type | Notes |
| --- | --- | --- |
| `document`, `person` | slug | identity |
| `token` | string, ≥ 16 chars base62 | the personal link; unique across the instance |
| `source` | enum `crm` \| `admin` \| `public` | |
| `suggested_capacity` | enum? | preselects the sign card |
| `prefill` | table? | what **this document** prefills on the sign card for this person, overriding the person's site-level defaults: `name`, `org`, `title`, `descriptor`, each optional. Absent — as on every participation written before the field existed — means the person's defaults alone |
| `link_revoked` | boolean | link no longer resolves (a reissue mints a new `token`) |
| `expires_at` | timestamp? | |
| `sent_at` | timestamp? | invitation message accepted by the mailer or exported; written in the same commit as `notified.invitation`, never before delivery |
| `first_opened_at`, `last_seen_at`, `opens` | | batched writes (`Action: track`, one commit per document per flush, whose `Opened` trailer names the people whose first open it recorded — that trailer is where the dashboard's `opened` activity entries come from) |
| `notify` | table | `channel`, `my_comments_addressed`, `reminders` (`behaviors/notifications.md` § Defaults). Records written by earlier builds may also carry `every_revision`, `daily_digest` and `phase_changes`; the schema still accepts them so those records stay writable, and nothing reads them |
| `notified` | table of event → timestamp | idempotency for sends, e.g. `notified.invitation`, `notified."disposition-v3"`, `notified."confirm-call-2026-09-28T14:00:00.000Z"`, `notified.delivered`, `notified."reminder-2"`; `notified.reminder = 2` is the reminder count beside those per-reminder timestamps. A timestamp here means the message was delivered, so the newest of them is when this document last reached the person (`notified."links-exported"` is an operator's CSV export, not a message) |
| `signature` | table? | absent = never signed; see below |

`prefill` table: `name`, `org`, `title` and `descriptor`, each optional, each overriding one of the person's site-level defaults (§ `people`). It is named for what it prefills — the `signature` table's own fields — so `prefill.title` is the default for `signature.title` and overrides the person's `role`, which is the same fact recorded as a standing one. An import writes it from the row it imported; nothing else writes it, and a signature never writes back into it.

`signature` table:

| Field | Type | Notes |
| --- | --- | --- |
| `capacity` | `personal` \| `official` | one signature per person per document |
| `display_name`, `descriptor`, `org`, `title` | string | per `behaviors/signatures.md` |
| `authorized` | boolean | official capacity attestation; must be true |
| `conditional` | boolean | |
| `listed` | boolean, default true | |
| `display_approved` | boolean | true for invited; **[phase 2]** false until reviewed for `public` |
| `signed_on_version` | integer | the version in force when the signature was given or last re-affirmed, per `behaviors/signatures.md` § A signature belongs to a version. Absent on records written before the field existed, where the number is read back from the `Version` trailer of the commit behind the signature in force |
| `revoked` | boolean | current signatory = present, `revoked = false`, `display_approved = true` |

Signed-at, revoked-at, re-signed-at and the revoke reason are not fields: they are the dates and `Reason` trailers of the `sign`, `revoke`, `resign` and `admin-revoke` commits touching this record — and of a `submit` commit carrying a `Signature` trailer, which is the same event written by comment mode.

A person's **position** (latest judgement) is not a field either: it is the latest `submitted` record in `submissions` for this person and document. The read model caches it.

Derived participant status for the dashboard: `not_sent` (staged, no `sent_at`) → `unopened` → `opened` → `drafting` (has a `draft` submission) → `commented` / `signed` / `signed_conditional` / `declined`. The wire values are snake_case throughout; screens label them for people.

## `submissions`

**The submission is the unit of meaning.** People spread a single line of thought across inline comments and a general note however it falls; those pieces only interpret correctly read together, by one author, against one version, with one judgement. So one record is one submission: an array of comments that share an author, a target version, a state and (once submitted) a judgement. Comments are never records of their own.

| Field | Type | Notes |
| --- | --- | --- |
| `document` | slug | |
| `id` | `<person>-<4 base62>`, e.g. `jane-doe-k7q2` | identity; readable in a file browser |
| `person` | slug | author |
| `version` | integer | version the comments were written against (may be rebased while `draft`) |
| `state` | enum `draft` \| `submitted` | at most one `draft` per person per document |
| `judgement` | enum? `sign` \| `sign_conditional` \| `comment` \| `decline` | set by the `submit` commit; absent while `draft` |
| `reason` | string? | optional note carried with a `decline` |
| `comments` | array of table | see below; may be empty for a comment-less `decline` |

Each `comments[]` entry:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `c<n>`, unique within the submission | referenced as `<submission>:<id>` in trailers |
| `anchor` | table? | absent for a general comment; otherwise per `behaviors/inline-comments.md` |
| `body` | string | |
| `disposition` | enum? `accepted` \| `partial` \| `declined` \| `noted` | absent = pending |
| `disposition_note` | string? | |
| `disposition_version` | integer? | version whose publish commit set it |

Timing comes from commits: the submission's first commit is when its author started, each `Action: comment` commit is a save, the `Action: submit` commit is the submission time. A `draft` record is readable by the team, always labeled *unsubmitted* and always whole. It is deleted (history keeps it) if its author removes every comment. Nothing is retained outside the record and nothing is cleaned out of it.

## Import from a CRM

The admin CLI imports invitees from NDJSON/CSV with columns matching `people` fields plus optional `suggested_capacity`. Email is the merge key into `people` **within the document's site**; an existing person on that site is matched, not duplicated, and the same address on another site is a different person and is never touched. One import is one commit (`Action: invite`): N people upserted, N participations created with their `prefill`, tokens minted. A gitsheets people sheet in the adopting team's repo exports directly to this shape.

**An import never overwrites a person field that already has a value unless it is told to.** The row's values always fill the person's *blank* fields and always become the participation's `prefill`; replacing a value the person already carries takes `--update` (`api/admin-cli.md`), because a second document's list is a reason to prefill differently, not a reason to correct the contact record. The dry run says per row which fields it would change and which it would keep, so the operator sees the difference before either mode writes anything.

## Relationships

```
sites     1 ─── n documents      (a document with no `site` belongs to the derived default site)
sites     1 ─── n people         (a person belongs to exactly one site; two sites may hold one email twice)
documents 1 ─── n participations n ─── 1 people
documents 1 ─── n submissions   (each by one person; at most one draft per person per document)
documents 1 ─── n versions      (body-changing commits of the document record)
```

## What is deliberately not here

- No `content`, `versions`, `reviews`, `drafts`, `comments`, `dispositions`, `signatures`, `notifications` or `sessions` sheets. Each is a field on one of the five records above, a set of commits, or (sessions) a signed token whose authority is the `operators` record.
- No `hostnames`, `certificates` or per-site settings sheet. A site is one record; the routing, certificate and DNS behind its hostname are infrastructure, not data (`behaviors/sites.md` § What a site is not).
- No `created_at` / `updated_at` fields anywhere; the history has them.
- No status or time in any path.
