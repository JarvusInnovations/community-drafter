# API: Admin

All routes under `/admin/api`. Auth: `Authorization: Bearer <ADMIN_TOKEN>` (CLI/agents) or an admin OAuth session cookie with the CSRF header (dashboard). Every write records `Actor` (email, or `cli:<label>` from the `X-Actor` header on bearer requests, default `cli`).

## Documents

- `GET /documents` → list with derived phase and counts.
- `POST /documents` `{ slug, title, capacities?, public_access?, show_signatories?, owner, sender_name, reply_to, revocation_window_hours?, tags? }` → document (state `draft`).
- `GET /documents/:slug` → document + versions (from content history) + counts.
- `PATCH /documents/:slug` → settings fields only (not `state`, not deadlines).
- `POST /documents/:slug/open` `{ comments_close_at, signing_closes_at }` → opens; requires ≥ 1 version; queues invitations. Errors: `validation_failed` (order), `no_version`.
- `POST /documents/:slug/schedule` `{ comments_close_at?, signing_closes_at? }` → extension only; `deadline_not_later` otherwise; records and announces.
- `POST /documents/:slug/close` → closes now (sets `signing_closes_at = now`); rare, recorded.
- `POST /documents/:slug/reopen` `{ comments_close_at?, signing_closes_at }`.
- `POST /documents/:slug/withdraw` `{ reason, public: boolean }`.

## Versions

- `GET /documents/:slug/versions` and `GET /documents/:slug/versions/:n` (derived from git; includes `body` markdown, `notes`, `commit`, dispositions).
- `POST /documents/:slug/versions`
  ```
  { body, summary, notes?, final?: boolean,
    dispositions?: [{ comment, outcome, note? }] }
  ```
  One transaction, one commit: content record, dispositions, and the `signing_closes_at` extension if in signing phase; notifications queued from it. Errors: `validation_failed` (summary length, unknown comment id, `declined` without note), `no_change` (text identical to current), `phase_closed` when `state` is `closed` or `withdrawn`. Response: the version (number, summary, commit) and `{ notified: { every_revision: n, dispositions: n, signers: n } }`.
- `GET /documents/:slug/compare?from=&to=` → same shape as the participant compare.

## People and invitations

- `POST /documents/:slug/invitations/import` — body: NDJSON or JSON array of `{ name, email, phone?, org?, role?, descriptor?, external_id?, suggested_capacity?, tags? }`. Merges people by email (case-insensitive), creates invitations for those without one, mints tokens. One transaction. Response: `{ people_created, people_updated, invitations_created, skipped_existing }`.
- `GET /documents/:slug/invitations` → participations as rows with derived status, tracking, signature summary, preferences; **never tokens**. Filters: `status`, `source`, `q`.
- `POST /documents/:slug/invitations/send` `{ only_unsent?: true, person?: [..] }` → queues `invitation` messages; response counts. With `MAILER=export`, response includes the CSV path/content.
- `POST /documents/:slug/invitations/links` `{ person?: [..] }` → CSV `person,name,email,link`. Recorded as an admin event with count. This is the only read path for tokens.
- `POST /documents/:slug/invitations/:person/revoke-link`, `.../reissue-link` (returns the new link once), `.../expire { expires_at }`.
- `POST /documents/:slug/invitations/remind` `{ target: "unopened" | "opened_not_acted", dry_run?: boolean }` → counts (respecting `reminders` preference).

## Signatures

- `GET /documents/:slug/signatures?include_revoked=true` → every participation with a signature table, with person names and the sign/revoke dates from history.
- `POST /documents/:slug/signatures/:person/revoke` `{ reason }` → admin revocation; confirmation email to the person.
- `POST /documents/:slug/signatures/:person/approve-display` (**[phase 2]**).

## Reviews and comments

- `GET /documents/:slug/comments?submitted=true|false|all&disposition=pending|answered|unanswered&version=` → comments with author, judgement, anchor, disposition, `saved_at`, `submitted_at`. Default `submitted=true`; unsubmitted comments are returned only on request and each carries `submitted: false` so consumers label them.
- `GET /documents/:slug/feedback-export` → the bundle defined in `behaviors/review-and-judgement.md` as JSON; `?format=md` renders the same as markdown for pasting into a prompt.

## Notifications

- `GET /documents/:slug/notifications` → per event: sent count (from `notified`), pending and failed (from the dispatcher's memory).
- `POST /documents/:slug/notifications/retry` `{ event?, person? }` → re-derives and re-dispatches anything not in `notified`.

## Activity

- `GET /documents/:slug/activity?limit=50&person=` → the document's commits, newest first, as `{ commit, date, subject, action, person, version, judgement, reason, actor }` parsed from trailers. This is the event log; there is no other.

## Instance

- `GET /whoami` → the actor and capability.
- `POST /init-data-repo` → writes sheet configs into an empty data repo (first boot helper; refuses if sheets exist).

## Principles

**Inherited**
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): every mutation here is exactly one transaction with a descriptive subject; the CLI prints the resulting commit subject so the agent can cite it.
- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): draft reads are labeled, and drafts are never mixed into `comments` results without the `unsubmitted` marker.

**Local**
- **Tokens leave through one door.** Only `invitations/links` and `reissue-link` return tokens, and both are recorded. Any new endpoint that would return a token must reuse one of them.
