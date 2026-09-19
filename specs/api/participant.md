# API: Participant

All routes are under `/i/:token/api`. The token resolves to an invitation; the person and document come from it. Unknown/revoked/expired tokens return 404 `not_found` for every route.

## `GET /i/:token/api/bundle`

Everything the document screen needs in one call.

Response:
```
{
  instance: { name },
  person:   { id, name },
  document: { slug, title, state, phase, opened_at, comments_close_at, signing_closes_at,
              capacities, show_signatories, reply_to, sender_name },
  version:  { number, summary, published_at, final, html, is_current },   // ?v=<n> selects
  versions: [{ number, summary, published_at, final, dispositions }],
  signature: null | { capacity, display_name, descriptor, org, title, conditional, listed,
                      signed_on_version, revoked, signed_at, revoked_at, resigned_at },   // dates from history
  position:  null | { judgement, version, at, submission },                             // from the latest submitted submission
  submissions: [{ id, version, state, judgement, reason, started_at, submitted_at,       // the person's own only
                  comments: [{ id, anchor | null, body, saved_at,
                               disposition: null | { outcome, note, version } }] }],
  signatories: { organizations: n, individuals: n, unlisted: n,
                 list: [{ display_name, capacity, descriptor, org, title }] } | { organizations, individuals, unlisted } | null,
  prefill: { name, org, role, descriptor, suggested_capacity },
  notify:   { channel, every_revision, daily_digest, phase_changes, my_comments_addressed, reminders, forced: [..] }
}
```
Side effect: records an open (batched).

## `POST /i/:token/api/signature`

Body: `{ capacity, display_name, descriptor?, org?, title?, authorized?, listed?, version }`.
Creates or replaces the person's signature (`behaviors/signatures.md`). Errors: `phase_closed`, `attestation_required`, `validation_failed`. Response: the signature. Sends the confirmation.

## `PATCH /i/:token/api/signature`

Body: any of the display fields, or `{ confirm: true }` to clear `conditional`. Response: the signature.

## `DELETE /i/:token/api/signature`

Body: `{ reason? }`. Revokes. Errors: `phase_closed`, `not_found`. Response: the signature with `revoked_at`. Sends the confirmation.

## `POST /i/:token/api/decline`

Body: `{ reason? }`. Records decline; revokes a signature if one exists (client must have confirmed). Allowed in commenting and signing phases. Response: `{ declined_at }`.

## Draft submission endpoints

A participant has at most one `draft` submission per document; the first saved comment creates it. Every comment save is its own commit (`Action: comment`, `Submission` trailer).

Granular saves so each finished comment is durable on its own. Every one of these responds **only after the write is committed to the record**; the response carries `saved_at`, which the client uses to clear its browser buffer and for conflict resolution. All are allowed only in the commenting phase (409 `phase_closed` otherwise; the client keeps its buffered copy and shows "Not saved").

- `GET /i/:token/api/draft` → the draft submission or `null`.
- `POST /i/:token/api/draft/comments` `{ version, anchor?, body, client_id }` → `{ submission, id, saved_at }`. Creates the draft if none. Omit `anchor` for a general comment. `client_id` makes the create idempotent across retries.
- `PUT /i/:token/api/draft/comments/:id` `{ body, anchor?, base_saved_at }` → `{ saved_at }`; 409 `stale_edit` with the server copy when `base_saved_at` is older than the stored `saved_at`.
- `DELETE /i/:token/api/draft/comments/:id` → 204; deleting the last comment deletes the draft.
- `POST /i/:token/api/draft/rebase` `{ to_version }` → re-anchors the draft's comments and updates its `version`; response lists per-comment `placed`.

The provisional judgement selection is client-side state until submission.

## `POST /i/:token/api/submit`

Body: `{ version, judgement, pending: n, signature?: {...} }` where `pending` is the count of buffered-but-unsaved items the client still holds; 409 `unsaved_items` when it is not zero, so a submission never silently omits a comment. The server flips the draft submission to `submitted` with the judgement (`Action: submit`, `Submission`, `Judgement`, `Version` trailers); a `decline` with no draft creates an empty submitted submission.
Effects per `behaviors/review-and-judgement.md`. Errors: `phase_closed` (except `decline` with no comments), `judgement_requires_comments`, `attestation_required` (when `sign`/`sign_conditional` with official capacity fields present but unattested). Response: `{ submission, signature }`.

## `GET /i/:token/api/versions/:n`

Response: `{ number, summary, published_at, final, html, my_comments: [...] }` (derived from the document record's body history).

## `GET /i/:token/api/compare?from=&to=`

Response: `{ from, to, summary: { changed, added, removed }, blocks: [{ status: "same"|"changed"|"added"|"removed", id, html }] }` where `changed` blocks' `html` contains the redline markup.

## `GET /i/:token/api/prefs` / `PUT /i/:token/api/prefs`

Body/response: the `notify` table plus `forced` (list of keys the server keeps on). `PUT` ignores attempts to turn off forced keys and reports them.

## `POST /i/:token/api/prefs/stop-optional`

Sets every non-forced optional preference off. Used by the one-click email link (GET to the page, which POSTs).

## Principles

**Inherited**
- [The link is the identity](../principles.md#the-link-is-the-identity): no other credential appears in this API.
- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): item-level saves acknowledged only when durable; submission refuses to drop unsaved items.
