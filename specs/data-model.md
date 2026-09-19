# Data Model

All durable state is a set of **gitsheets** sheets in the data repository, and **git is the data model**: a record holds the *current* state of one thing, and everything about *when* and *why* it changed lives in the commit history. The tree is flat and semantic: paths name things (a document, a person, a comment), never moments, statuses or versions. There are no history tables, no version tables, no event logs. To answer a time question, read `git log`.

Field names below are the on-record names. Timestamps are ISO 8601 UTC. Identifiers are lowercase slugs unless stated.

## Sheets

| Sheet | Path template | Format | One record per |
| --- | --- | --- | --- |
| `documents` | `${{ slug }}` | TOML | document (settings and schedule) |
| `content` | `${{ document }}` | markdown | the document's text; its history is the version history |
| `people` | `${{ id }}` | TOML | person known to the instance |
| `participations` | `${{ document }}/${{ person }}` | TOML | one person's relationship to one document: link, tracking, preferences, position, signature |
| `comments` | `${{ document }}/${{ id }}` | TOML | one comment, from first save through submission and disposition |

Five sheets. Cross-references are by slug so records read sensibly in a file browser.

## Commits are the events

Every mutation is one `repo.transact` commit. The subject is a human sentence; the **trailers carry the structured data** an agent or a dashboard reads back. Trailers used across the record:

| Trailer | Values | On |
| --- | --- | --- |
| `Action` | `create`, `open`, `extend`, `close`, `reopen`, `withdraw`, `publish`, `invite`, `send`, `sign`, `resign`, `revoke`, `decline`, `comment`, `submit`, `dispose`, `prefs`, `track`, `admin-revoke`, `link-revoke`, `link-reissue` | every commit |
| `Document` | slug | every commit about a document |
| `Person` | slug | every commit about a person's action |
| `Actor` | admin email, `cli:<label>`, or `participant` | every commit |
| `Version` | integer | `publish` (the number this commit becomes), `submit`, `comment`, `sign` (the version seen) |
| `Summary` | 1–200 chars | `publish` (the one-line changelog) |
| `Final` | `true` | `publish` when declared final |
| `Notes` | text | `publish` (team-facing) |
| `Judgement` | `sign` \| `sign_conditional` \| `comment` \| `decline` | `submit` |
| `Comments` | comma-separated comment ids | `submit`, `dispose` |
| `Reason` | text | `revoke`, `decline`, `withdraw`, `admin-revoke` |
| `Request-Id` | id | every commit from a request |

Examples of subjects: `sign: jane-doe on coalition-charter`, `publish: coalition-charter v3`, `submit: jane-doe on coalition-charter v2 (sign_conditional)`, `comment: jane-doe on coalition-charter (c-8fk2qa)`, `extend: coalition-charter signing to 2026-09-30T21:00Z`.

The dashboard's "recent activity", a person's history, the list of versions, and "how was this statement approved" are all `git log` queries filtered by trailer. Nothing duplicates them into records.

## `documents`

| Field | Type | Notes |
| --- | --- | --- |
| `slug` | string, `^[a-z0-9][a-z0-9-]{1,60}$` | identity; never changes |
| `title` | string | |
| `state` | enum `draft` \| `open` \| `closed` \| `withdrawn` | phases within `open` derive from the clock (`behaviors/document-lifecycle.md`) |
| `opened_at` | timestamp? | |
| `comments_close_at` | timestamp? | |
| `signing_closes_at` | timestamp? | |
| `revocation_window_hours` | integer, default 72 | |
| `capacities` | array of `personal` \| `official`, default both | |
| `public_access` | enum `none` \| `read` \| `participate`, default `none` | `participate` is **[phase 2]** |
| `show_signatories` | enum `list` \| `count` \| `none`, default `list` | |
| `owner`, `sender_name`, `reply_to` | string | |
| `withdraw_reason`, `withdraw_public` | string?, boolean | |
| `tags` | array of string | |

No `current_version`, no `created_at`, no `updated_at`: the first commit of the record is creation, the last is the update, and the version count is the content history.

## `content` and versions

One markdown record per document: frontmatter `document`, body = the current text. Nothing else touches this record, so **every commit that changes it is a version**.

| Version attribute | Derived from |
| --- | --- |
| `number` | position of the commit in the first-parent history of the record, oldest = 1 |
| `commit` | the hash (internal; never shown to participants) |
| `summary` | the `Summary` trailer, else the subject with any `publish: <slug> v<n>` prefix removed |
| `published_at` | committer date |
| `published_by` | `Actor` trailer, else author name |
| `final` | `Final: true` |
| `notes` | `Notes` trailer |
| `body` | the record at that commit |

Numbering is stable because the branch forbids force-pushes. The read model indexes versions from `git log` at boot and appends on publish. A publish commit also writes the disposition fields on the comments it answers, so the commit that *is* the version carries the answers it gave (`Comments` trailer lists them).

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

One record per person per document. It is created by an invitation and then accumulates everything that person does on that document. Current state only; the story is in `git log --grep` on `Person`/`Document` trailers.

| Field | Type | Notes |
| --- | --- | --- |
| `document`, `person` | slug | identity |
| `token` | string, ≥ 16 chars base62 | the personal link; unique across the instance |
| `source` | enum `crm` \| `admin` \| `public` | |
| `suggested_capacity` | enum? | preselects the sign card |
| `link_revoked` | boolean | link no longer resolves (a reissue mints a new `token`) |
| `expires_at` | timestamp? | |
| `sent_at` | timestamp? | invitation message sent or exported |
| `first_opened_at`, `last_seen_at`, `opens` | | batched writes (`Action: track`) |
| `notify` | table | `channel`, `every_revision`, `daily_digest`, `phase_changes`, `my_comments_addressed`, `reminders` |
| `notified` | table of event → timestamp | idempotency for sends, e.g. `notified.v3`, `notified.signing-opened`, `notified.digest = "2026-09-21"`, `notified.reminder = 2`; failures live in logs, not the record |
| `judgement` | enum? `sign` \| `sign_conditional` \| `comment` \| `decline` | the person's latest submitted position |
| `judgement_version` | integer? | version that position was taken on |
| `general_comment` | string? | the general note, saved as written (see `comments` for inline) |
| `general_submitted` | boolean | whether the general note has been submitted with a judgement |
| `declined_reason` | string? | |
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

Signed-at, revoked-at, reaffirmed-at and the revoke reason are not fields: they are the dates and `Reason` trailers of the `sign`, `revoke`, `resign` and `admin-revoke` commits touching this record. The read model caches them from `git log` for display ("You signed on Sep 19").

Derived participant status for the dashboard: `unopened` → `opened` → `drafting` (has unsubmitted comments) → `commented` / `signed` / `signed (conditional)` / `declined`.

## `comments`

One record per comment, created the moment a participant saves it and patched through submission and disposition. Flat: the status is a field, the path is the id.

| Field | Type | Notes |
| --- | --- | --- |
| `document` | slug | |
| `id` | `c-<6 base62>` | unique within the document |
| `person` | slug | author |
| `version` | integer | version the comment was written against |
| `anchor` | table | see `behaviors/inline-comments.md` (`version`, `commit`, `block`, `heading_path`, `quote`, `prefix`, `suffix`, `start`, `spans_blocks`) |
| `body` | string | |
| `submitted` | boolean | false = saved, not yet sent (readable by the team under an *unsubmitted* label) |
| `judgement` | enum? | copied from the submitting position so the comment reads alone |
| `disposition` | enum? `accepted` \| `partial` \| `declined` \| `noted` | absent = pending |
| `disposition_note` | string? | |
| `disposition_version` | integer? | version whose publish commit set it |

`saved_at` and `submitted_at` are the dates of the `comment` and `submit` commits touching the record; the API surfaces them from the read model. A deleted comment is a deleted record (its existence stays in history).

## Import from a CRM

The admin CLI imports invitees from NDJSON/CSV with columns matching `people` fields plus optional `suggested_capacity`. Email is the merge key into `people`; an existing person is updated, not duplicated. One import is one commit (`Action: invite`): N people upserted, N participations created, tokens minted. A gitsheets people sheet in the adopting team's repo exports directly to this shape.

## Relationships

```
documents 1 ─── 1 content            (version history = content's git history)
documents 1 ─── n participations n ─── 1 people
participations 1 ─── n comments      (same document + person)
```

## What is deliberately not here

- No `versions`, `reviews`, `drafts`, `dispositions`, `signatures`, `notifications` or `events` sheets. Each of those is either a field on one of the five records above or a set of commits.
- No `created_at` / `updated_at` fields anywhere; the history has them.
- No status or time in any path.
