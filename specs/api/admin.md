# API: Admin

All routes under `/admin/api`. Auth: an operator token as `Authorization: Bearer` (CLI, bots) or the operator session cookie with the `X-Requested-With: drafter` header (dashboard); see `api/auth.md` and `behaviors/operators.md`. Every write records `Actor` = the operator's email. **Document routes are scoped**: a caller who is not one of the document's operators gets 404 `not_found`, identical to an unknown slug (superadmins pass everywhere; `behaviors/operators.md` § Superadmins).

## Documents

- `GET /documents` → the caller's documents with derived phase and counts (every document for a superadmin).
- `POST /documents` `{ slug, title, audience, capacities?, addressed_to?, public_access?, show_signatories?, sender_name, reply_to, revocation_window_hours?, tags? }` → document (state `draft`) with `created_by` and `operators = [caller]`. `audience` is `public` | `closed` and is **required** — who the finished statement is for is not a thing to default into (`data-model.md` § Audience); omitting it is 400 `invalid_request` like any other missing required field. It is stored as given and is independent of `public_access`, which is the separate drafting-time read setting and is never written from it. `addressed_to` is an array of recipient names; it is **required when `audience = closed`** — 422 `validation_failed` with `field: "addressed_to"` otherwise — and allowed when `audience = public`.
- `GET /documents/:slug/operators` → `[{ email, name, kind, active }]`.
- `POST /documents/:slug/operators` `{ email }` → adds an active operator from the sheet (`Action: doc-operator-add`); 422 when the email is not an active operator.
- `DELETE /documents/:slug/operators/:email` → removes (`Action: doc-operator-remove`); 409 `last_operator` when it would leave none.
- `GET /documents/:slug` → document + versions (from content history) + counts. Every document shape this API returns carries `audience` and `addressed_to` as stored, beside `public_access`; nothing is derived from anything. A document stored without `audience` returns `closed` (`data-model.md` § Audience). The signature counts carry `behind`: live signatures attached to a version older than the current one (`behaviors/signatures.md` § A signature belongs to a version).
- `PATCH /documents/:slug` → settings fields only (not `state`, not deadlines); accepts `audience` and `addressed_to` on the same terms as `POST /documents`, each optional here. The `closed` requirement is checked against the document as it will be after the patch, so setting `audience: "closed"` on a document with no recipients and no `addressed_to` in the same request is 422 `validation_failed`.
- `POST /documents/:slug/open` `{ comments_close_at, signing_closes_at }` → opens; requires ≥ 1 version; sends the invitations that have never been sent. Deadlines are ISO 8601 with a zone (offset or `Z`), stored as UTC. Response: the document summary plus `invitations: { sent, failed, failures: [{ person, error }] }`; only the accepted messages are marked `sent_at` (`behaviors/notifications.md` § Sending), so a rejected recipient stays unsent and a later `.../invitations/send` reaches them. Errors: `validation_failed` (format, order, `comments_close_at` already past), `no_version`.
- `POST /documents/:slug/schedule` `{ comments_close_at?, signing_closes_at? }` → extension only; `deadline_not_later` otherwise; records and announces.
- `POST /documents/:slug/close` → closes now (sets `signing_closes_at = now`); rare, recorded.
- `POST /documents/:slug/reopen` `{ comments_close_at?, signing_closes_at }`.
- `POST /documents/:slug/withdraw` `{ reason, public: boolean }`.

## Versions

- `GET /documents/:slug/versions` and `GET /documents/:slug/versions/:n` (derived from git; includes `body` markdown, `notes`, `commit`, dispositions).
- `POST /documents/:slug/versions`

  ```
  { body, summary, notes?, final?: boolean,
    dispositions?: [{ submission, comment, outcome, note? }] }
  ```

  One transaction, one commit: the document body, disposition fields on the affected submissions (`Disposed` trailer), and the `signing_closes_at` extension if in signing phase; notifications queued from it. Errors: `validation_failed` (summary length, unknown comment id, `declined` without note), `no_change` (text identical to current), `phase_closed` when `state` is `closed` or `withdrawn`. Response: the version (number, summary, commit) and `{ notified: { every_revision: n, dispositions: n, signers: n } }`.
- `GET /documents/:slug/compare?from=&to=` → same shape as the participant compare.

## People and invitations

- `POST /documents/:slug/invitations/import[?dry_run=1]` — body: NDJSON or JSON array of `{ name, email, phone?, org?, role?, descriptor?, external_id?, suggested_capacity?, tags? }`. Merges people by email (case-insensitive), creates invitations for those without one, mints tokens. One transaction. Response: `{ people_created, people_updated, invitations_created, skipped_existing, rows: [{ email, name, person, action, changes }] }` where `action` is `invite_new_person`, `invite_existing_person` or `skip_existing` and `changes` lists the person fields the row would overwrite. With `dry_run=1` nothing is written and the same shape comes back with `dry_run: true`, so a list can be built and reviewed before anything exists.
- `DELETE /documents/:slug/invitations/:person` → removes a staged invitation that has never been sent (`Action: uninvite`); 409 `already_sent` once `sent_at` is set, 409 `has_activity` if the person opened the link, has a submission or a signature. The person record stays.
- `GET /documents/:slug/invitations` → participations as rows with derived status (`not_sent` first, so a staged list reads as staged), tracking, signature summary, preferences; **never tokens**. Filters: `status`, `source`, `q`.
- `POST /documents/:slug/invitations/send` `{ only_unsent?: true, person?: [..], dry_run?: true }` → sends `invitation` messages; response `{ sent, failed, skipped: [{ person, reason }], failures: [{ person, error }] }` with skip reasons `already_sent`, `link_revoked`, `no_email`. `sent` counts the messages the mailer accepted, and only those are marked `sent_at`; the rest are named in `failures` and remain unsent. With `dry_run` nothing is sent or recorded and the response is `{ dry_run: true, would_send: [{ person, name }], skipped }`. With `MAILER=export`, the real send includes the CSV path/content for the rows it wrote.
- `POST /documents/:slug/invitations/links` `{ person?: [..] }` → CSV `person,name,email,link`. Recorded as an admin event with count. This is the only read path for tokens.
- `POST /documents/:slug/invitations/:person/revoke-link`, `.../reissue-link` (returns the new link once), `.../expire { expires_at }`.
- `POST /documents/:slug/invitations/remind` `{ target: "unopened" | "opened_not_acted", min_age_hours?: number, dry_run?: boolean }` → sends reminders to the targets that have the `reminders` preference on and have not been messaged within `min_age_hours` (default 48; `0` sends regardless — `behaviors/notifications.md` § Sending). Response `{ sent, failed, skipped_recent, skipped_pref, min_age_hours, failures: [{ person, error }] }`; with `dry_run`, `{ dry_run: true, targeted, skipped_recent, skipped_pref, min_age_hours }` and nothing is sent or recorded. 422 `validation_failed` when `min_age_hours` is negative or not a number.

## Signatures

- `GET /documents/:slug/signatures?include_revoked=true` → every participation with a signature table, with person names, the sign/revoke dates from history, the version each signature is attached to, and `behind: true` on a live signature whose version is older than the document's current one.
- `POST /documents/:slug/signatures/:person/revoke` `{ reason }` → admin revocation; confirmation email to the person.
- `POST /documents/:slug/signatures/:person/approve-display` (**[phase 2]**).

## Reviews and comments

- `GET /documents/:slug/submissions?state=submitted|draft|all&disposition=pending|answered|unanswered&version=&person=` → whole submissions (author, version, state, judgement, reason, `started_at`, `submitted_at`, comments with anchors and dispositions). Default `state=submitted`; drafts come only on request and carry `state: draft` so consumers label them. **There is no endpoint that returns a comment without its submission.**
- `GET /documents/:slug/feedback-export` → the bundle defined in `behaviors/review-and-judgement.md` as JSON, organized by submission; `?format=md` renders the same as markdown for pasting into a prompt.

## Notifications

- `GET /documents/:slug/notifications` → per event: sent count (from `notified`), pending and failed (from the dispatcher's memory), plus `failures: [{ event, person, error, at }]` so the operator can see who did not get what and why.
- `POST /documents/:slug/notifications/retry` `{ event?, person? }` → re-derives and re-dispatches anything not in `notified`.

## Activity

- `GET /documents/:slug/activity?limit=50&person=` → the document's commits, newest first, as `{ commit, date, subject, action, person, version, judgement, reason, actor }` parsed from trailers, plus `deadlines` — `[{ deadline, from?, to }]` from the `Deadlines` trailer — on an `extend` or `reopen`. This is the event log; there is no other.

## Operators

- `GET /operators` → every operator (email, name, kind, active, superadmin, title, org); any active operator may read the list, because adding someone to a document requires choosing from it.
- `POST /operators` `{ email, name, kind?, title?, org?, notes? }` → creates (`Action: operator-add`); 409 when the email exists.
- `PATCH /operators/:email` `{ name?, active?, superadmin?, title?, org?, notes? }` → updates (`Action: operator-update`). Deactivating yourself is refused (422). `superadmin` may be set only by a superadmin (403 `forbidden` otherwise) and never on yourself (422).
- `DELETE /operators/:email` → removes the record (`Action: operator-remove`) and drops the email from every document's `operators` list in the same commit; 409 `last_operator` when that would leave any document with none.

## Instance

- `GET /whoami` → `{ email, name, kind, expires_at, transport: "bearer" | "cookie" }`.
- `POST /refresh` → the data-repository refresh webhook (`behaviors/operators.md`): authenticated by `X-Hub-Signature-256` over the raw body with `DATA_REPO_WEBHOOK_SECRET`, never by an operator token. Responds `{ head_before, head_after, rebuilt }`, or 409 `refresh_busy` / `refresh_diverged`.
- `POST /init-data-repo` → writes sheet configs into an empty data repo (first boot helper; refuses if sheets exist).

## Principles

**Inherited**

- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): every mutation here is exactly one transaction with a descriptive subject; the CLI prints the resulting commit subject so the agent can cite it.
- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): draft reads are labeled, and drafts are never mixed into `comments` results without the `unsubmitted` marker.

**Local**

- **Tokens leave through one door.** Only `invitations/links` and `reissue-link` return tokens, and both are recorded. Any new endpoint that would return a token must reuse one of them.
