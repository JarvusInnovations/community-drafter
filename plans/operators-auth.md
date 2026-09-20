---
status: done
depends: []
specs:
  - specs/behaviors/operators.md
  - specs/api/auth.md
  - specs/api/admin.md
  - specs/api/conventions.md
  - specs/data-model.md
  - specs/architecture.md
  - specs/behaviors/notifications.md
pr: 25
---

# Plan: operators-auth

## Scope

The API side of operators: the `operators` sheet and record type, `documents.created_by`/`operators`, magic-link sign-in, stateless signed sessions and CLI tokens, the device-code flow, the `operator` gateway capability with document scoping, operator and document-operator endpoints, the bootstrap operator, the `refresh` webhook, and removal of Google OAuth and the instance-wide `ADMIN_TOKEN`. Out: the CLI commands and dashboard screens (→ `operators-cli-and-dashboard`).

## Implements

- `specs/behaviors/operators.md` — all sections.
- `specs/api/auth.md` — all endpoints and the token shape.
- `specs/api/admin.md` — document scoping, `operators` and `documents/:slug/operators` endpoints, `whoami`, `refresh`.
- `specs/api/conventions.md` — the `operator` and `webhook` capabilities, new error codes.
- `specs/data-model.md` — the `operators` sheet, `created_by`/`operators` on documents, new actions.
- `specs/architecture.md` — the authentication table and configuration (`AUTH_SECRET`, `BOOTSTRAP_OPERATOR_EMAIL`, `DATA_REPO_WEBHOOK_SECRET`).
- `specs/behaviors/notifications.md` — the `operator-magic-link` message.

## Approach

1. `.gitsheets/operators.toml` + Zod record; add `created_by` and `operators` to the documents schema and record; a one-time migration on boot that sets `created_by`/`operators` on existing documents to the bootstrap operator (single commit, `Actor: system`) so the pilot's demo document keeps working.
2. `apps/api/src/auth/` rewrite: `tokens.ts` (JWT HS256 sign/verify with `purpose`), `magic.ts` (issue + used-`jti` set), `device.ts` (pending codes), `routes.ts` per `api/auth.md`; delete the Google module and `jose`'s JWKS use if no longer needed; `DEV_ADMIN_EMAIL` becomes a dev-only shortcut that mints a session without email (kept for tests and local work, ignored in production).
3. Gateway: replace `admin` with `operator` (bearer or cookie → verify token → load operator record → `active` check → `request.principal = { kind: "operator", email, name, operatorKind }`); CSRF header on cookie writes; a route-level `documentScoped: true` config that 404s when the slug's `operators` list lacks the caller; `webhook` capability with HMAC verification for `refresh`.
4. Operators routes and document-operator routes with the `last_operator` rule; `POST /documents` sets `created_by`/`operators`; `GET /documents` filters by membership.
5. Bootstrap on boot; `Actor` from the principal everywhere (delete `X-Actor` handling).
6. `refresh`: write lock, push-backlog check, `git fetch` + fast-forward, read-model rebuild; refuse on divergence.
7. Mailer: the magic-link template; send through the existing dispatcher path but without `notified` marks.
8. Tests for every Validation line, using the dev shortcut to mint sessions and a fake mailer to capture magic links.

## Validation

- [x] With an empty `operators` sheet and `BOOTSTRAP_OPERATOR_EMAIL` set, boot creates the operator in one `Actor: system` commit; with a non-empty sheet the variable is ignored. (`storage/operators-bootstrap.test.ts`)
- [x] `POST /auth/login` returns 202 for an unknown email and sends nothing; for an active operator it sends exactly one magic link whose callback sets a session cookie and redirects to the validated return path; a second use of the same link is refused. (`auth/auth.test.ts`)
- [x] A deactivated operator's existing session and CLI token both get 401 `operator_inactive` on the next request. (`auth/auth.test.ts`, bearer and cookie transports each covered separately)
- [x] Device-code flow end to end: `device` → magic link → `approve` → `token` returns a 90-day token; `token` before approval returns `device_pending`; an expired code returns 404. (`auth/auth.test.ts` for the end-to-end flow and `device_pending`; `auth/device.test.ts` unit-tests the store's expiry directly with a tiny TTL rather than the real 15-minute window)
- [x] Cookie-authenticated writes without `X-Requested-With: drafter` → 403 `csrf_required`; bearer writes unaffected. (`auth/auth.test.ts`)
- [x] An operator not on a document gets 404 for every document route, byte-identical to an unknown slug; `GET /documents` lists only their documents. (`gateway/gateway.test.ts`, `routes/admin/operators.test.ts`)
- [x] Removing the last operator from a document returns 409 `last_operator`; adding a non-operator email returns 422. (`routes/admin/operators.test.ts`)
- [x] Every admin-originated commit's `Actor` trailer is the operator's email; no `X-Actor` header is honored. (asserted directly across `storage/commit.test.ts`/`operators-bootstrap.test.ts`/`routes/admin/*.test.ts`; the header is read nowhere in the new gateway/routes code — confirmed by inspection, not by a dedicated "send a bogus X-Actor and prove it's ignored" test)
- [x] `refresh` with a valid signature fast-forwards a change pushed from a second clone and the read model reflects it; an invalid signature is 401; a pending push backlog returns 409 `refresh_busy`. (`routes/admin/refresh.test.ts`: fast-forward, already-up-to-date, `refresh_busy`, invalid signature — all four)
- [x] Google OAuth code, `ADMIN_TOKEN`, `GOOGLE_*`, `OAUTH_*`, `COOKIE_SECRET` are gone from the code, `.env.example`, `tf/` and the runbook; `AUTH_SECRET`, `BOOTSTRAP_OPERATOR_EMAIL`, `DATA_REPO_WEBHOOK_SECRET` replace them. (verified by repo-wide grep; `tf/`'s `community-drafter-cookie-secret` *secret* is intentionally kept and reused for `AUTH_SECRET` — only the Cloud Run env var name changed)

## Risks / unknowns

- **Existing CLI and tests** authenticate with `ADMIN_TOKEN`; this plan breaks them until `operators-cli-and-dashboard` lands. Sequence the two PRs back to back and keep the dev shortcut so the e2e tests can mint a token.
- **Magic-link deliverability** is now on the sign-in path; the pilot needs Postmark verified before the first human operator can log in. The bootstrap operator can still be created without email.

## Notes

- Added the `already_exists` (409) error code for `POST /operators`'s duplicate-email case — `specs/api/admin.md` specified 409 but `conventions.md`'s error table (predating that endpoint) had no generic conflict code. Reconciled in the same PR (`docs(specs): add already_exists to the 409 error table`) rather than left as drift.
- A magic-purpose token carries an additive `return` claim (the validated `POST /auth/login` return path, or the device flow's `/auth/device?code=<user_code>`) — not in `specs/api/auth.md`'s literal claim list, but `GET /auth/callback?token=` has nowhere else to carry it since the callback URL only has room for `token`.
- `GET /auth/login` (the `DEV_ADMIN_EMAIL` dev-only shortcut) reuses the `/login` path with a different HTTP method than the spec'd `POST /auth/login` — no route collision, and it auto-creates its own operator record on first use rather than requiring `BOOTSTRAP_OPERATOR_EMAIL` to exactly match `DEV_ADMIN_EMAIL` in every dev/test environment.
- Found and fixed a real latent race while writing `refresh`'s tests: gitsheets' push daemon runs its own `git fetch` shortly after boot (`checkStartupBacklog`, deferred via `setImmediate`), which can race a concurrent `git fetch` from `refresh` itself and trip git's ref-transaction "incorrect old value provided" guard. `instance.ts`'s `fetchWithRetry` retries the fetch a couple of times to absorb this. Production impact should be minimal (a webhook call arrives well after boot), but worth knowing about.
- `packages/cli` needed **zero** source changes — it already sent `DRAFTER_ADMIN_TOKEN` as `Authorization: Bearer` and no test asserted on `X-Actor`. `test-support.ts`'s `TEST_ADMIN_TOKEN` is now a real `purpose: cli` JWT minted directly through `auth/tokens.ts` (the "dev shortcut" applied at the test-harness layer, simpler than driving the HTTP device-code dance for every test file); `e2e.test.ts` passes unmodified.
- `Actor` dropped the old `{ kind: "cli"; label }` form entirely; every background/system-triggered commit (tracker flushes, phase transitions, notification batches, bootstrap, migration) now attributes to plain `"system"` rather than `cli:<label>`.

## Follow-ups

- Deferred to [`operators-cli-and-dashboard`](operators-cli-and-dashboard.md) — the web app's `/admin/login` page, the `/auth/device` approval page, and the CLI's `login`/`logout`/`whoami`/`operators *` commands. That plan's Scope/Approach/Validation already cover all three; no edit was needed to absorb this deferral, since it was written after this plan and already accounts for it.
- Tracked as: the device-code expiry path (`404` after 15 minutes) is unit-tested against `DeviceCodeStore` directly with a short TTL, not integration-tested end-to-end through the real 15-minute window — treated as sufficient given the store's expiry logic is a small, self-contained piece.
