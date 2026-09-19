---
status: planned
depends: []
specs:
  - specs/behaviors/operators.md
  - specs/api/auth.md
  - specs/api/admin.md
  - specs/api/conventions.md
  - specs/data-model.md
  - specs/architecture.md
  - specs/behaviors/notifications.md
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
- [ ] With an empty `operators` sheet and `BOOTSTRAP_OPERATOR_EMAIL` set, boot creates the operator in one `Actor: system` commit; with a non-empty sheet the variable is ignored.
- [ ] `POST /auth/login` returns 202 for an unknown email and sends nothing; for an active operator it sends exactly one magic link whose callback sets a session cookie and redirects to the validated return path; a second use of the same link is refused.
- [ ] A deactivated operator's existing session and CLI token both get 401 `operator_inactive` on the next request.
- [ ] Device-code flow end to end: `device` → magic link → `approve` → `token` returns a 90-day token; `token` before approval returns `device_pending`; an expired code returns 404.
- [ ] Cookie-authenticated writes without `X-Requested-With: drafter` → 403 `csrf_required`; bearer writes unaffected.
- [ ] An operator not on a document gets 404 for every document route, byte-identical to an unknown slug; `GET /documents` lists only their documents.
- [ ] Removing the last operator from a document returns 409 `last_operator`; adding a non-operator email returns 422.
- [ ] Every admin-originated commit's `Actor` trailer is the operator's email; no `X-Actor` header is honored.
- [ ] `refresh` with a valid signature fast-forwards a change pushed from a second clone and the read model reflects it; an invalid signature is 401; a pending push backlog returns 409 `refresh_busy`.
- [ ] Google OAuth code, `ADMIN_TOKEN`, `GOOGLE_*`, `OAUTH_*`, `COOKIE_SECRET` are gone from the code, `.env.example`, `tf/` and the runbook; `AUTH_SECRET`, `BOOTSTRAP_OPERATOR_EMAIL`, `DATA_REPO_WEBHOOK_SECRET` replace them.

## Risks / unknowns
- **Existing CLI and tests** authenticate with `ADMIN_TOKEN`; this plan breaks them until `operators-cli-and-dashboard` lands. Sequence the two PRs back to back and keep the dev shortcut so the e2e tests can mint a token.
- **Magic-link deliverability** is now on the sign-in path; the pilot needs Postmark verified before the first human operator can log in. The bootstrap operator can still be created without email.

## Notes
(closeout)

## Follow-ups
(closeout)
