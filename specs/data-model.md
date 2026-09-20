# Data Model

All durable state is a set of **gitsheets** sheets in the data repository, and **git is the data model**: a record holds the *current* state of one thing, and everything about *when* and *why* it changed lives in the commit history. The tree is flat and semantic: paths name things (a document, a person, a submission), never moments, statuses or versions. There are no history tables, no version tables, no event logs. To answer a time question, read `git log`.

Field names below are the on-record names. Timestamps are ISO 8601 UTC. Identifiers are lowercase slugs unless stated.

## Sheets

| Sheet | Path template | Format | One record per |
| --- | --- | --- | --- |
| `documents` | `${{ slug }}` | markdown | document: settings in frontmatter, **the text as the body**; the body's history is the version history |
| `people` | `${{ id }}` | TOML | person known to the instance |
| `participations` | `${{ document }}/${{ person }}` | TOML | one person's relationship to one document: link, tracking, preferences, signature |
| `submissions` | `${{ document }}/${{ id }}` | TOML | one person's set of comments against one version, from first save through submission and disposition |
| `operators` | `${{ id }}` | TOML | one person or bot allowed to run documents |

Five sheets. Cross-references are by slug so records read sensibly in a file browser.

## Commits are the events

Every mutation is one `repo.transact` commit. The subject is a human sentence; the **trailers carry the structured data** an agent or a dashboard reads back.

| Trailer | Values | On |
| --- | --- | --- |
| `Action` | `create`, `settings`, `open`, `extend`, `close`, `reopen`, `withdraw`, `publish`, `invite`, `send`, `sign`, `resign`, `revoke`, `comment`, `submit`, `prefs`, `track`, `admin-revoke`, `link-revoke`, `link-reissue`, `link-export`, `link-expire`, `uninvite`, `operator-add`, `operator-update`, `operator-remove`, `doc-operator-add`, `doc-operator-remove` | every commit |
| `Document` | slug | every commit about a document |
| `Person` | slug | every commit about a person's action |
| `Actor` | an operator's email, `participant`, or `system` (bootstrap) | every commit |
| `Version` | integer | `publish` (the number this commit becomes), `submit`, `comment`, `sign` (the version seen) |
| `Summary` | 1–200 chars | `publish` (the one-line changelog) |
| `Final` | `true` | `publish` when declared final |
| `Notes` | text | `publish` (team-facing) |
| `Submission` | submission id | `comment`, `submit` |
| `Judgement` | `sign` \| `sign_conditional` \| `comment` \| `decline` | `submit` |
| `Disposed` | comma-separated `<submission>:<comment>` refs | `publish` |
| `Reason` | text | `revoke`, `withdraw`, `admin-revoke`, and `submit` with `decline` |
| `Request-Id` | id | every commit from a request |

Subjects look like `sign: jane-doe on coalition-charter`, `publish: coalition-charter v3`, `submit: jane-doe on coalition-charter v2 (sign_conditional)`, `comment: jane-doe on coalition-charter (jane-doe-k7q2)`, `extend: coalition-charter signing to 2026-09-30T21:00Z`.

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
| `public_access` | enum `none` \| `read` \| `participate`, default `none` | `participate` is **[phase 2]** |
| `show_signatories` | enum `list` \| `count` \| `none`, default `list` | |
| `created_by` | email | the operator who created the document; always also in `operators` |
| `operators` | array of email | current operators of this document; never empty |
| `sender_name`, `reply_to` | string | |
| `withdraw_reason`, `withdraw_public` | string?, boolean | |
| `tags` | array of string | |
| `body` | markdown | the text |

The sheet's format sets `body = 'body'` and does not set `title`, so the body may or may not begin with a heading; `title` is a plain setting.

### Versions

A **version** is a commit in the record's history **in which the body changed**. Settings-only commits (`Action: settings`, `extend`, `open` …) are not versions. Nothing about a version is stored; all of it derives:

| Version attribute | Derived from |
| --- | --- |
| `number` | position among body-changing commits, oldest = 1 |
| `commit` | the hash (internal; never shown to participants) |
| `summary` | the `Summary` trailer, else the subject with any `publish: <slug> v<n>` prefix removed |
| `published_at` | committer date |
| `published_by` | `Actor` trailer, else author name |
| `final` | `Final: true` |
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

## `people`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | slug | stable across documents |
| `name` | string | default signature name |
| `email` | string, email | merge key on import |
| `phone` | string? | E.164; **[phase 2]** SMS |
| `org`, `role`, `descriptor` | string? | defaults for the sign card |
| `source` | string | `crm`, `public`, `admin` |
| `external_id` | string? | id in the adopting team's own CRM |

Never rendered on any participant or public surface.

## `participations`

One record per person per document, created by an invitation. Current state only; the story is in `git log` on the `Person` and `Document` trailers.

| Field | Type | Notes |
| --- | --- | --- |
| `document`, `person` | slug | identity |
| `token` | string, ≥ 16 chars base62 | the personal link; unique across the instance |
| `source` | enum `crm` \| `admin` \| `public` | |
| `suggested_capacity` | enum? | preselects the sign card |
| `link_revoked` | boolean | link no longer resolves (a reissue mints a new `token`) |
| `expires_at` | timestamp? | |
| `sent_at` | timestamp? | invitation message accepted by the mailer or exported; written in the same commit as `notified.invitation`, never before delivery |
| `first_opened_at`, `last_seen_at`, `opens` | | batched writes (`Action: track`) |
| `notify` | table | `channel`, `every_revision`, `daily_digest`, `phase_changes`, `my_comments_addressed`, `reminders` |
| `notified` | table of event → timestamp | idempotency for sends, e.g. `notified.v3`, `notified.signing-opened`, `notified.digest = "2026-09-21"`, `notified."reminder-2"`; `notified.reminder = 2` is the reminder count beside those per-reminder timestamps. A timestamp here means the message was delivered, so the newest of them is when this document last reached the person (`notified."links-exported"` is an operator's CSV export, not a message) |
| `signature` | table? | absent = never signed; see below |

`signature` table:

| Field | Type | Notes |
| --- | --- | --- |
| `capacity` | `personal` \| `official` | one signature per person per document |
| `display_name`, `descriptor`, `org`, `title` | string | per `behaviors/signatures.md` |
| `authorized` | boolean | official capacity attestation; must be true |
| `conditional` | boolean | |
| `listed` | boolean, default true | |
| `display_approved` | boolean | true for invited; **[phase 2]** false until reviewed for `public` |
| `signed_on_version` | integer | |
| `revoked` | boolean | current signatory = present, `revoked = false`, `display_approved = true` |

Signed-at, revoked-at, re-signed-at and the revoke reason are not fields: they are the dates and `Reason` trailers of the `sign`, `revoke`, `resign` and `admin-revoke` commits touching this record.

A person's **position** (latest judgement) is not a field either: it is the latest `submitted` record in `submissions` for this person and document. The read model caches it.

Derived participant status for the dashboard: `not_sent` (staged, no `sent_at`) → `unopened` → `opened` → `drafting` (has a `draft` submission) → `commented` / `signed` / `signed (conditional)` / `declined`.

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

The admin CLI imports invitees from NDJSON/CSV with columns matching `people` fields plus optional `suggested_capacity`. Email is the merge key into `people`; an existing person is updated, not duplicated. One import is one commit (`Action: invite`): N people upserted, N participations created, tokens minted. A gitsheets people sheet in the adopting team's repo exports directly to this shape.

## Relationships

```
documents 1 ─── n participations n ─── 1 people
documents 1 ─── n submissions   (each by one person; at most one draft per person per document)
documents 1 ─── n versions      (body-changing commits of the document record)
```

## What is deliberately not here

- No `content`, `versions`, `reviews`, `drafts`, `comments`, `dispositions`, `signatures`, `notifications` or `sessions` sheets. Each is a field on one of the five records above, a set of commits, or (sessions) a signed token whose authority is the `operators` record.
- No `created_at` / `updated_at` fields anywhere; the history has them.
- No status or time in any path.
