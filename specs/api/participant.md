# API: Participant

All routes are under `/i/:token/api`. The token resolves to an invitation; the person and document come from it. Unknown/revoked/expired tokens return 404 `not_found` for every route.

## `GET /i/:token/api/bundle`

Everything the document screen needs in one call.

`site` is the **document's** site — name, and logo and accent where set (`behaviors/sites.md` § Identity on a surface) — which on a deployment with no sites is the default site, whose `name` is the instance name. It replaces the earlier `instance: { name }`. Reached on another site's host, this route redirects to the document's own before returning anything.

Response:

```
{
  site:     { name, logo_url, accent },
  person:   { id, name },
  document: { slug, title, state, phase, opened_at, comments_close_at, signing_closes_at,
              capacities, show_signatories, audience, addressed_to, reply_to, sender_name },
  version:  { number, summary, published_at, final, html, is_current },   // ?v=<n> selects; ?citations= sets the mode
  versions: [{ number, summary, published_at, final, dispositions }],
  signature: null | { capacity, display_name, descriptor, org, title, conditional, listed,
                      signed_on_version, revoked, signed_at, revoked_at, resigned_at },   // dates from history
  position:  null | { judgement, version, at, submission },                             // from the latest submitted submission
  submissions: [{ id, version, state, judgement, reason, started_at, submitted_at,       // the person's own only
                  comments: [{ id, anchor | null, body, saved_at,
                               disposition: null | { outcome, note, version } }] }],
  signatories: { organizations: n, individuals: n, unlisted: n,
                 list: [{ display_name, capacity, descriptor, org, title }] } | { organizations, individuals, unlisted } | null,
  prefill: { name, org, role, descriptor, suggested_capacity },   // resolved per field: the participation's `prefill` (whose `title` supplies `role`), else the person's site-level default, else absent
  notify:   { channel, every_revision, daily_digest, phase_changes, my_comments_addressed, reminders, forced: [..] }
}
```

`audience` and `addressed_to` are the document's stored values (`../data-model.md` § Audience); a document stored without `audience` reads `closed` and `addressed_to` is `[]`. They are here because the sign card's who-sees sentence is built from them and `show_signatories` (`../behaviors/signatures.md` § Consent at signing). `public_access` is **not** in the bundle: it governs who may read the draft, which is not a fact a signer is asked to stand behind.

Side effect: records an open (batched).

## `POST /i/:token/api/signature`

Body: `{ capacity, display_name, descriptor?, org?, title?, authorized?, listed?, version }`.
Creates or replaces the person's signature (`behaviors/signatures.md`). In official capacity `org`, `title` and `authorized = true` are all required. Errors: `phase_closed`, `attestation_required`, `validation_failed` (a missing `org` or `title` names the field). Response: the signature. Sends the confirmation.

## `PATCH /i/:token/api/signature`

Body: any of the display fields, or `{ confirm: true }` to clear `conditional`. A change to `org` on an official signature requires `authorized: true` in the same body — `attestation_required` otherwise — and an official signature may not be saved with a blank `title` (`validation_failed`). A body that changes any display field sends `listing-changed-<ts>`; `{ confirm: true }` alone changes none and sends nothing. Response: the signature.

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

Response: `{ number, summary, published_at, final, html, my_comments: [...] }` (derived from the document record's body history). `?citations=links|footnotes|hybrid` sets how citations are presented in `html` (`../behaviors/versioning.md` § Citations); `links` is the default here and on the bundle, because that is what a reader who expressed no preference gets. The mode changes only the HTML: the blocks a comment can be anchored to are the same in every mode, which is why `compare` deliberately has no such parameter.

## `GET /i/:token/api/compare?from=&to=`

Response: `{ from, to, summary: { changed, added, removed, items: [{ kind: "paragraph"|"heading"|"list item"|"table", change: "changed"|"added"|"removed", count }] }, blocks: [{ status: "same"|"changed"|"added"|"removed", id, html }] }` where `changed` blocks' `html` contains the redline markup. Counts are per comparison unit, not per HTML element: a table is one (`behaviors/versioning.md` § Diff), and `items` is what the summary line is built from.

## `GET /i/:token/api/statement.pdf`

The deliverable (`../screens/deliverable.md`): the current version's text, its title block, and the signatory list as it stands, rendered to a PDF. `application/pdf`, `Content-Disposition: attachment` with the filename that spec gives. `?paper=letter|a4` selects the paper size; letter is the default. `?citations=links|footnotes|hybrid` selects how citations are presented (`../behaviors/versioning.md` § Citations); `hybrid` is the default on every PDF door.

Every holder of a personal link may fetch it, in every phase in which they may read the document at all — they can already read every word of it on their own screen, and the `audience` gate that guards the public door has nothing to add here. `not_found` for a document with no version yet and for a `withdrawn` one. Whether the render is watermarked `DRAFT` is a fact about the document, never about the caller (`../screens/deliverable.md` § Draft and clean).

## `GET /i/:token/api/prefs` / `PUT /i/:token/api/prefs`

Body/response: the `notify` table plus `forced` (list of keys the server keeps on) and `email_masked` (`j***@example.org` — `screens/preferences.md`'s masked email display; no other endpoint exposes a participant's own contact address). `PUT` ignores attempts to turn off forced keys and reports them (as `ignored`).

## `POST /i/:token/api/prefs/stop-optional`

Sets every non-forced optional preference off. Used by the one-click email link (GET to the page, which POSTs).

## Principles

**Inherited**

- [The link is the identity](../principles.md#the-link-is-the-identity): no other credential appears in this API.
- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): item-level saves acknowledged only when durable; submission refuses to drop unsaved items.
