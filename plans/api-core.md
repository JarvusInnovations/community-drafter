---
status: planned
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

- [ ] An undeclared route returns 403 in a test, proving deny-by-default.
- [ ] `POST /init-data-repo` against an empty data repo produces the one-commit result `initDataRepo` already returns; against a repo with existing sheet configs it refuses without committing (deferred from `deploy`).
- [ ] `apps/api` no longer uses the deprecated `disableRequestLogging` option (deferred from `workspace-bootstrap`).
- [ ] Unknown, revoked and expired tokens produce byte-identical 404 bodies.
- [ ] Signing during `commenting` and `signing` succeeds; during `closed` returns `phase_closed` naming the deadline; official capacity without `authorized` returns `attestation_required`.
- [ ] Publishing during `signing` moves `signing_closes_at` to at least now + `revocation_window_hours` in the same commit.
- [ ] `schedule` with an earlier time returns `deadline_not_later`.
- [ ] `import` of 50 NDJSON rows with 5 duplicate emails yields 45 people, 50 participations, one commit.
- [ ] `invitations/links` returns tokens and produces an admin `Action: link-export`-style record in activity; `GET invitations` never contains a token (asserted by regex over the response).
- [ ] `activity` returns parsed trailers for the last 50 commits of a document.
- [ ] Bundle `signatories` counts equal the number of `signature` tables with `revoked = false` and `display_approved = true`, organizations first alphabetically, individuals chronologically.

## Risks / unknowns

- **Idempotency cache in memory** — lost on restart; acceptable because every write is also naturally idempotent by record state.

## Notes

(closeout)

## Follow-ups

(closeout)
