# API: Admin

All routes under `/admin/api`. Auth: an operator token as `Authorization: Bearer` (CLI, bots) or the operator session cookie with the `X-Requested-With: drafter` header (dashboard); see `api/auth.md` and `behaviors/operators.md`. Every write records `Actor` = the operator's email.

**Every request resolves to a site** from the host it was addressed to (`behaviors/sites.md`), and the site scopes everything this API returns: documents, the operators directory, and the hostname of any link in a response. A token minted on another site's host is 401 `unauthenticated`. A document on another site is 404 `not_found`.

**Document routes are scoped**: a caller who is not one of the document's operators gets 404 `not_found`, identical to an unknown slug (superadmins pass everywhere; `behaviors/operators.md` § Superadmins).

## Documents

- `GET /documents` → the caller's documents **on the resolved site**, with derived phase and counts. A superadmin on the default site's host gets every document on every site, each carrying its `site`.
- `POST /documents` `{ slug, title, audience, site?, capacities?, addressed_to?, public_access?, show_signatories?, sender_name?, reply_to?, revocation_window_hours?, tags? }` → document (state `draft`) with `created_by` and `operators = [caller]`. `site` defaults to the resolved site; naming a site the caller does not belong to is 404 `not_found`, like any other cross-site read. `sender_name` and `reply_to` may be omitted, in which case the site's are used for this document's mail (`behaviors/sites.md` § Mail); they are not copied onto the record. `audience` is `public` | `closed` and is **required** — who the finished statement is for is not a thing to default into (`data-model.md` § Audience); omitting it is 400 `invalid_request` like any other missing required field. It is stored as given and is independent of `public_access`, which is the separate drafting-time read setting and is never written from it. `addressed_to` is an array of recipient names; it is **required when `audience = closed`** — 422 `validation_failed` with `field: "addressed_to"` otherwise — and allowed when `audience = public`.
- `GET /documents/:slug/operators` → `[{ email, name, kind, active }]`.
- `POST /documents/:slug/operators` `{ email }` → adds an active operator **from the document's site's group** (`Action: doc-operator-add`); 422 when the email is not an active operator of that site.
- `DELETE /documents/:slug/operators/:email` → removes (`Action: doc-operator-remove`); 409 `last_operator` when it would leave none.
- `GET /documents/:slug` → document + versions (from content history) + counts. Every document shape this API returns carries `site` (the slug, `default` for a document with none), the `site_url` its personal and public links are built on, and `audience` and `addressed_to` as stored, beside `public_access`; nothing is derived from anything. A document stored without `audience` returns `closed` (`data-model.md` § Audience). The signature counts carry `behind`: live signatures attached to a version older than the current one (`behaviors/signatures.md` § A signature belongs to a version).
- `PATCH /documents/:slug` → settings fields only (not `state`, not deadlines); accepts `site`, moving the document to another site the caller belongs to (404 otherwise; `"default"` moves it back to the deployment's own site by clearing the field) — the slug, tokens and history are untouched and only the hostname its participants are sent to changes, from the next message and the next redirect; accepts `audience` and `addressed_to` on the same terms as `POST /documents`, each optional here. The `closed` requirement is checked against the document as it will be after the patch, so setting `audience: "closed"` on a document with no recipients and no `addressed_to` in the same request is 422 `validation_failed`.
- `POST /documents/:slug/open` `{ comments_close_at, signing_closes_at }` → opens; requires ≥ 1 version; sends the invitations that have never been sent. Deadlines are ISO 8601 with a zone (offset or `Z`), stored as UTC. Response: the document summary plus `invitations: { sent, failed, failures: [{ person, error }] }`; only the accepted messages are marked `sent_at` (`behaviors/notifications.md` § Sending), so a rejected recipient stays unsent and a later `.../invitations/send` reaches them. Errors: `validation_failed` (format, order, `comments_close_at` already past), `no_version`.
- `POST /documents/:slug/schedule` `{ comments_close_at?, signing_closes_at? }` → extension only; `deadline_not_later` otherwise; `no_deadline_set` (422) when the document has no such deadline to extend, with a message naming the deadline in words and pointing at `POST /documents/:slug/open` rather than reporting that a stored field must move later; records and announces.
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

## The deliverable

- `GET /documents/:slug/statement.pdf` → the deliverable (`../screens/deliverable.md`) as `application/pdf`, `Content-Disposition: attachment`. `?paper=letter|a4` (default letter), `?citations=links|footnotes|hybrid` (default hybrid, `../behaviors/versioning.md` § Citations) and `?draft=1` — which forces the watermarked form of a document that has already gone clean, for an operator who wants a marked copy to circulate; there is no flag the other way, because a clean copy of an unfinished statement is the one thing nobody may produce. Errors: `not_found` for an unknown slug, a document with no version, and a `withdrawn` one. Recorded nowhere: rendering is a read, and the PDF is never written to the data repo.

## People and invitations

- `POST /documents/:slug/invitations/import[?dry_run=1][&update=1]` — body: NDJSON or JSON array of `{ name, email, phone?, org?, role?, descriptor?, external_id?, suggested_capacity?, tags? }`. Merges people by email (case-insensitive) **within the document's site** (`behaviors/sites.md` § People are per site) — the same address on another site is a different person and is never read or written — creates invitations for those without one, writes each row's sign-card values as that participation's `prefill`, and mints tokens. One transaction.

  **`update` decides what may be overwritten, and nothing else.** Without it, a row fills an existing person's *blank* fields and keeps every value they already carry. With `update=1`, the row's values replace them, and the row also refreshes the `prefill` of a participation that already exists. Neither mode ever changes a person on another site, and neither writes a signature.

  Response: `{ update, people_created, people_updated, people_overwritten, invitations_created, skipped_existing, rows: [{ email, name, person, action, would_change, kept }] }`. `action` is `invite_new_person`, `invite_existing_person` or `skip_existing`. `would_change` names what this row would actually change in this mode — person fields by their own names, and an already-existing participation's prefill fields as `prefill.<field>`; `kept` names the person fields whose row value differs from a value already set and would be left alone, which is empty under `update=1` and is the list `--update` would act on. `people_updated` counts rows that change at least one person field, `people_overwritten` the rows that replace a value that was already set. With `dry_run=1` nothing is written and the same shape comes back with `dry_run: true`, so a list can be built and reviewed before anything exists.
- `DELETE /documents/:slug/invitations/:person` → removes a staged invitation that has never been sent (`Action: uninvite`); 409 `already_sent` once `sent_at` is set, 409 `has_activity` if the person opened the link, has a submission or a signature. The person record stays.
- `GET /documents/:slug/invitations` → participations as rows with derived status (`not_sent` first, so a staged list reads as staged), tracking, signature summary, preferences; **never tokens**. A row's `name` and `org`, and its `prefill` object, are the values **this document** resolves for the sign card — the participation's `prefill` where it has one, else the person's site-level default (`data-model.md` § A person belongs to a site) — so the list reads as what the invitee will actually see rather than as the contact record behind it. Filters: `status`, `source`, `q` (matched against the same resolved name, and the email), and `listed` (`true` | `false`), which keeps only rows carrying a live signature with that listing choice — a row with no signature, or with a revoked one, matches neither value.
- `POST /documents/:slug/invitations/send` `{ only_unsent?: true, person?: [..], dry_run?: true }` → sends `invitation` messages; response `{ sent, failed, skipped: [{ person, reason }], failures: [{ person, error }] }` with skip reasons `already_sent`, `link_revoked`, `no_email`. `sent` counts the messages the mailer accepted, and only those are marked `sent_at`; the rest are named in `failures` and remain unsent. With `dry_run` nothing is sent or recorded and the response is `{ dry_run: true, would_send: [{ person, name }], skipped }`. With `MAILER=export`, the real send includes the CSV path/content for the rows it wrote.
- `POST /documents/:slug/invitations/links` `{ person?: [..] }` → CSV `person,name,email,link`. Recorded as an admin event with count. This is the only read path for tokens.
- `POST /documents/:slug/invitations/:person/revoke-link`, `.../reissue-link` (returns the new link once), `.../expire { expires_at }`.
- `POST /documents/:slug/invitations/remind` `{ target: "unopened" | "opened_not_acted", min_age_hours?: number, dry_run?: boolean }` → sends reminders to the targets that have the `reminders` preference on and have not been messaged within `min_age_hours` (default 48; `0` sends regardless — `behaviors/notifications.md` § Sending). Response `{ sent, failed, skipped_recent, skipped_pref, min_age_hours, failures: [{ person, error }] }`; with `dry_run`, `{ dry_run: true, targeted, skipped_recent, skipped_pref, min_age_hours }` and nothing is sent or recorded. 422 `validation_failed` when `min_age_hours` is negative or not a number.

## Signatures

- `GET /documents/:slug/signatures?include_revoked=true` → every participation with a signature table, with person names, the sign/revoke dates from history, the version each signature is attached to, the signer's listing choice (`listed`), and `behind: true` on a live signature whose version is older than the document's current one.
- `POST /documents/:slug/signatures/:person/revoke` `{ reason }` → admin revocation; confirmation email to the person.
- `POST /documents/:slug/signatures/:person/approve-display` (**[phase 2]**).

## Reviews and comments

- `GET /documents/:slug/submissions?state=submitted|draft|all&disposition=pending|answered|unanswered&version=&person=` → whole submissions (author, version, state, judgement, reason, `started_at`, `submitted_at`, comments with anchors and dispositions). Default `state=submitted`; drafts come only on request and carry `state: draft` so consumers label them. **There is no endpoint that returns a comment without its submission.**
- `GET /documents/:slug/feedback-export` → the bundle defined in `behaviors/review-and-judgement.md` as JSON, organized by submission; `?format=md` renders the same as markdown for pasting into a prompt.

## Notifications

- `GET /documents/:slug/notifications` → per event: sent count (from `notified`), pending and failed (from the dispatcher's memory), plus `failures: [{ event, person, error, at }]` so the operator can see who did not get what and why. Plus `operator_digest_sent`: the date (`YYYY-MM-DD`) the last operator digest was delivered for this document, absent when none has been (`behaviors/notifications.md` § Operator digest).
- `POST /documents/:slug/notifications/retry` `{ event?, person? }` → re-derives and re-dispatches anything not in `notified`.

## Activity

- `GET /documents/:slug/activity?limit=50&person=` → the document's commits, newest first, as `{ commit, date, subject, action, person, version, judgement, reason, actor }` parsed from trailers, plus `deadlines` — `[{ deadline, from?, to }]` from the `Deadlines` trailer — on an `extend` or `reopen`. A `track` commit's `Opened` trailer expands into one entry per person with `action: "opened"` and no commit of its own; a `track` commit naming nobody is omitted. This is the event log; there is no other.

## Operators

Scoped to the resolved site's operator group (`behaviors/sites.md` § Operators and tenancy). An email outside the caller's groups is 404 `not_found`, the same body as an unknown operator.

- `GET /operators` → the resolved site's group (email, name, kind, active, superadmin, title, org); any active operator of the site may read it, because adding someone to a document requires choosing from it.
- `POST /operators` `{ email, name, kind?, title?, org?, notes? }` → creates the record if the email is new and adds it to the resolved site's group, in one commit (`Action: operator-add`, whose `Site` trailer names the group joined); 409 when the email is already in this site's group. On the default host there is no group to write: membership of the default site is derived, so the commit is the record alone. Mails the new operator (`behaviors/notifications.md` → `operator-added`) after the commit; a mailer that refuses is logged and does not fail the request, which reports the record that was written either way. Adding an operator to a document (`POST /documents/:slug/operators`) mails them the same way (`operator-added-to-document`).
- `PATCH /operators/:email` `{ name?, active?, superadmin?, title?, org?, notes? }` → updates (`Action: operator-update`) an operator in a group the caller shares. Deactivating yourself is refused (422). `superadmin` may be set only by a superadmin (403 `forbidden` otherwise) and never on yourself (422).
- `DELETE /operators/:email` → **superadmin only** (403 `forbidden` otherwise), because the record is instance-wide: removes it (`Action: operator-remove`), drops the email from every site's and every document's `operators` list in the same commit; 409 `last_operator` when that would leave any site or document with none. Removing someone from one site is `DELETE /sites/:slug/operators/:email`.

## Sites

`behaviors/sites.md`. The default site is derived, not stored: it appears in `GET /sites` with `slug: "default"` and is not writable.

- `GET /sites` → the caller's sites (every site for a superadmin): `{ slug, hostname, name, sender_name, sender_email, reply_to, logo_url, accent, operators, documents, from_line, hostname_verified, sender_verified, dns, default }`. `from_line` is the address mail from this site will actually use; the two `*_verified` flags are observations (does the hostname route here, has the provider accepted this sender), never promises — each is read from what this process has actually seen (a request that arrived on the hostname, a message the provider accepted), and `sender_verified` is `null` when neither has happened yet, which every surface shows as "not verified yet". `dns` is the record list below, and `default` marks the derived site.
- `POST /sites` `{ slug, hostname, name, sender_name?, sender_email?, reply_to, logo_url?, accent? }` → creates (`Action: site-create`, `Site` trailer) with `created_by` and `operators = [caller]`. Superadmin only. 409 `hostname_taken` when another site claims the hostname or it is the deployment's own; 422 `validation_failed` on a hostname carrying a scheme, port or path. Response includes `dns: [{ type, name, value, purpose }]` — the CNAME for the hostname, and the provider's two sender records when `sender_email` is given. **Creating a site routes nothing**: the mapping and the certificate are `tf/` (`docs/operations.md`).
- `GET /sites/:slug` → one site, same shape.
- `PATCH /sites/:slug` `{ name?, sender_name?, sender_email?, reply_to?, logo_url?, accent? }` → updates (`Action: site-update`). Superadmin only; 422 on the default site, which is derived from the deployment's configuration. `hostname` is not patchable: a site has exactly one hostname, and changing it is a new site, because DNS, a certificate and every link already sent are attached to the old one.
- `DELETE /sites/:slug` → removes the record (`Action: site-remove`). Superadmin only; 409 `site_in_use` while any document names it, since deleting it would silently move those documents to the default site and change the hostname their participants were already sent. The domain mapping is removed separately in `tf/`.
- `GET /sites/:slug/operators` → the site's group.
- `POST /sites/:slug/operators` `{ email, name? }` → adds an operator to the group (`Action: site-operator-add`), creating the record when the email is new (`name` is read only then, and defaults to the address); 422 when the operator is not active. The default site's group is derived and not writable here (422): someone joins it by belonging to no other site. Any operator of the site may call this and its `DELETE` counterpart; only the site itself is superadmin-gated.
- `DELETE /sites/:slug/operators/:email` → removes the email from the group (`Action: site-operator-remove`); the record and other memberships are untouched. 409 `last_operator` when it would empty the group or leave one of the site's documents with no operator.

## Instance

- `GET /whoami` → `{ email, name, kind, expires_at, transport: "bearer" | "cookie" }`.
- `POST /refresh` → the data-repository refresh webhook (`behaviors/operators.md`): authenticated by `X-Hub-Signature-256` over the raw body with `DATA_REPO_WEBHOOK_SECRET`, never by an operator token. Responds `{ head_before, head_after, rebuilt }`, or 409 `refresh_busy` / `refresh_diverged`.
- `POST /init-data-repo` → writes sheet configs into an empty data repo (first boot helper; refuses if sheets exist).

## Principles

**Inherited**

- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): every mutation here is exactly one transaction with a descriptive subject; the CLI prints the resulting commit subject so the agent can cite it.
- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): draft reads are labeled, and drafts are never mixed into `comments` results without the `unsubmitted` marker.

**Local**

- **Scope is resolved before the route runs.** The site comes from the host, the operator from the token, and both are settled before any handler reads a slug — so a cross-site request is a 404 from the same code path as an unknown slug, not a check each endpoint has to remember.
- **Tokens leave through one door.** Only `invitations/links` and `reissue-link` return tokens, and both are recorded. Any new endpoint that would return a token must reuse one of them.
