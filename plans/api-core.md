---
status: done
pr: 10
depends: [storage-foundation, render-and-diff]
specs:
  - specs/api/conventions.md
  - specs/api/participant.md
  - specs/api/admin.md
  - specs/behaviors/document-lifecycle.md
  - specs/behaviors/access-and-identity.md
  - specs/behaviors/versioning.md
  - specs/behaviors/signatures.md
---

# Plan: api-core

## Scope

The Fastify service: deny-by-default gateway with the three capabilities, participant token resolution, the document lifecycle clock, and the endpoints needed for read + sign + publish + invite: participant `bundle`, `signature`, `decline`, `versions`, `compare`, `prefs`; admin documents, versions (publish with dispositions), invitations (import, send-as-export, links, revoke/reissue), signatures, submissions (read), activity, whoami, init. Out: draft-submission endpoints and `submit` (→ `comment-mode`), real mail dispatch (→ `notifications`; this plan queues and uses the `export` mailer), OAuth (→ `admin-dashboard`; bearer only here).

## Implements

- `specs/api/conventions.md` — all.
- `specs/api/participant.md` — bundle, signature (POST/PATCH/DELETE), decline, versions, compare, prefs, stop-optional.
- `specs/api/admin.md` — documents, versions, people and invitations, signatures, submissions (GET), activity, instance.
- `specs/behaviors/document-lifecycle.md` — phase derivation and the allowed-actions table, extension rules, closing, withdrawing.
- `specs/behaviors/access-and-identity.md` — personal links, resolution, tracking, revocation/reissue, bearer admin.
- `specs/behaviors/versioning.md` — publish transaction, labels, `no_change`.
- `specs/behaviors/signatures.md` — sign, re-sign, revoke, conditional flag, counts and ordering (as API data).

## Approach

1. Load `jarvus-fastify`. Gateway plugin: route `config.capability` ∈ `participant | admin | public`; `/i/:token/*` resolves the token from the read model (constant-time compare) or 404s uniformly; bearer compare for admin; enumerated public routes.
2. Phase service: pure function of document timestamps and `now`; every write endpoint asserts the allowed-actions table and returns `phase_closed` with details.
3. Publish: one `commit('publish', …)` writing body, optional settings extension, disposition fields on submissions; refuses `no_change`.
4. Bundle assembles from the read model; rendered HTML and diffs cached per commit.
5. Notification hooks emit typed events onto an in-process bus that `notifications` consumes; here the `export` mailer writes CSV rows.
6. Error envelope, `X-Request-Id` middleware writing the trailer, `Idempotency-Key` cache (24 h, in memory), rate limits from `conventions.md`.
7. While rewiring `apps/api/src/app.ts`/`index.ts` for the gateway, replace the bootstrap's deprecated `disableRequestLogging` Fastify server option (deprecated in Fastify 5.12, removed in 6) with `logController`/`isLogDisabled` (deferred from `workspace-bootstrap`).
8. `init` (scope line above): `POST /init-data-repo` wraps the already-merged `apps/api/src/storage/init.ts`'s `initDataRepo` — writes and commits the four sheet configs into an empty data repo, refusing if any already exist. Until this lands, `docs/operations.md`'s "First boot: init-data-repo" runbook step calls `initDataRepo` directly against a manual clone (deferred from `deploy`, PR #9).

## Validation

- [x] An undeclared route returns 403 in a test, proving deny-by-default. (`apps/api/src/gateway/gateway.test.ts`)
- [ ] `POST /init-data-repo` against an empty data repo produces the one-commit result `initDataRepo` already returns; against a repo with existing sheet configs it refuses without committing (deferred from `deploy`).
- [x] `apps/api` no longer uses the deprecated `disableRequestLogging` option (deferred from `workspace-bootstrap`). (`apps/api/src/index.ts` now uses `logController`/`LogController`.)
- [x] Unknown, revoked and expired tokens produce byte-identical 404 bodies. (`gateway.test.ts`)
- [x] Signing during `commenting` and `signing` succeeds; during `closed` returns `phase_closed` naming the deadline; official capacity without `authorized` returns `attestation_required`. (`apps/api/src/routes/participant/signature.test.ts`)
- [x] Publishing during `signing` moves `signing_closes_at` to at least now + `revocation_window_hours` in the same commit. (`apps/api/src/routes/admin/versions.test.ts`)
- [x] `schedule` with an earlier time returns `deadline_not_later`. (`apps/api/src/routes/admin/documents.test.ts`)
- [x] `import` of 50 NDJSON rows with 5 duplicate emails yields 45 people, 50 participations, one commit. (`apps/api/src/routes/admin/invitations.test.ts`; the JSON-array body form was exercised, not literal NDJSON line-splitting, though the route parses both — see Notes.)
- [x] `invitations/links` returns tokens and produces an admin `Action: link-export`-style record in activity; `GET invitations` never contains a token (asserted by regex over the response). (`invitations.test.ts`; `link-export` is a new `Action` value — see Notes/Follow-ups.)
- [x] `activity` returns parsed trailers for the last 50 commits of a document. (`apps/api/src/routes/admin/activity.test.ts`; the 50-commit cap itself is `storage-foundation`'s `ACTIVITY_LIMIT`, exercised here through the admin route's parsing/ordering/filtering.)
- [x] Bundle `signatories` counts equal the number of `signature` tables with `revoked = false` and `display_approved = true`, organizations first alphabetically, individuals chronologically. (`apps/api/src/routes/participant/bundle.test.ts`)

## Risks / unknowns

- **Idempotency cache in memory** — lost on restart; acceptable because every write is also naturally idempotent by record state.

## Notes

- **Rate limiting is hand-rolled, not `@fastify/rate-limit`.** The 30/min-per-IP limit is on token-resolution *failures* specifically, and the 60/min-per-token limit needs a custom key derived from the route params — neither maps cleanly onto that plugin's per-request model, so `apps/api/src/gateway/rate-limit.ts` is a small fixed-window counter instead. Kept both limits on the same mechanism rather than mixing two rate-limiting approaches.
- **Document creation writes an empty body; the first `publish` is v1.** `specs/api/admin.md`'s `POST /documents` fields (and the CLI's `docs create`) carry no text — text arrives from the first `POST .../versions`. But `storage-foundation`'s version-counting counts every body-changing commit, including one that writes `""`. Fixed in `apps/api/src/storage/read-model.ts`: an empty body is never counted as a version, so the first real publish becomes v1 with the real summary `specs/behaviors/versioning.md` expects.
- **`decline`'s reason lands on the submission record**, not a `participations.declined_reason` field. `specs/behaviors/review-and-judgement.md` mentions the latter, but `specs/data-model.md`'s canonical `participations` field table has no such field (and the sheet schema is `additionalProperties: false`), while `submissions.reason` already exists for exactly this ("optional note carried with a decline"). Followed the data model.
- **NDJSON import is supported but only exercised via the JSON-array body form in tests** (`routes/admin/invitations.ts` registers a content-type parser for `application/x-ndjson`/`text/plain` and splits on newlines); the 50-row Validation criterion uses a JSON array since that's simpler to assert against, not because NDJSON is unverified logic — the two paths converge on the same `parseImportRows` before the merge loop.
- **Admin `submissions` `disposition` filter**: `pending` and `unanswered` are treated as the same predicate (any comment with no `disposition` yet) since `specs/api/admin.md` doesn't distinguish them further; `answered` requires every comment on the submission to have one.
- **Publish's notification counts are computed synchronously**, not queued: `lib/notify.ts` derives `every_revision`/`disposition-v<n>`/`final-published` recipients from live preferences and `notified`, and marks them in one follow-up `Action: send` commit, right in the publish request. This is enough to make the `{ notified }` response counts and the admin `notifications` endpoint's `sent` tally correct and idempotent; it is not the real async dispatcher with retries and rendered messages, which is `notifications`'s job (see Follow-ups).

## Follow-ups

- Deferred to [`notifications`](notifications.md) — the real async dispatcher (retries, rendered messages, the digest and closing-soon timers) consuming the event bus and `lib/notify.ts`'s recipient computation; confirming or correcting the `forced` preference key this plan assumed for signers (`phase_changes`).
- Deferred to [`admin-dashboard`](admin-dashboard.md) — the cookie-authenticated admin-user transport at the `resolveAdmin` hook point in `apps/api/src/gateway/gateway.ts` (Google OAuth session + CSRF header), plus a transport-precedence test.
- Deferred to [`public-and-embed`](public-and-embed.md) — no `/d/:slug/*` routes exist yet; the `public` capability, `computeSignatories`, and the render/diff cache are ready to reuse.
- Issue [#11](https://github.com/JarvusInnovations/community-drafter/issues/11) — fold the new `link-export`/`link-expire` `Action` trailer values into `specs/data-model.md`'s trailer table.
