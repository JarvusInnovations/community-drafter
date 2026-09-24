---
status: done
depends: [operators-auth]
specs:
  - specs/api/admin-cli.md
  - specs/screens/admin-dashboard.md
  - specs/behaviors/operators.md
pr: 26
---

# Plan: operators-cli-and-dashboard

## Scope

The human and agent surfaces for operators: `drafter-axi login` (device code) / `logout` / `whoami`, profile-file token storage with silent refresh, `operators *` and `docs operators *` verbs, removal of `--owner` and `--actor`; the dashboard's sign-in page, device-approval page, operator-scoped document list, operators page, and the per-document operators panel. Also updates the skill's SKILL.md and the runbook. Out: the API (→ `operators-auth`).

## Implements

- `specs/api/admin-cli.md` — configuration, `login`/`logout`/`whoami`, `operators *`, `docs operators *`, `docs create` without `--owner`.
- `specs/screens/admin-dashboard.md` — sign-in, device approval, scoped list, operators page, document operators panel, sign-out.
- `specs/behaviors/operators.md` — the CLI device-code flow and the "any current operator may add operators" rule as exercised from both surfaces.

## Approach

1. CLI: `login <email> [--url <instance>]` resolves the instance from `--url`, else `DRAFTER_URL`, else fails with a one-line hint → `POST /auth/device`, print the user code and the "check your email" line, poll `token` at the returned interval until approved or expired; write `~/.config/drafter/<profile>.toml` (mode 600) with `url`, `token`, `email`, `expires_at`; every later command reads `url` from the profile unless `DRAFTER_URL` is set; before each command, if the token is older than 30 days call `refresh` and rewrite the file; `DRAFTER_TOKEN` env overrides; home view without a profile explains `login --url`.
2. Operators and document-operator commands over the new endpoints; every mutation prints the commit subject.
3. Web: `/admin/login` form; `/auth/device` approval page; route guard redirecting to login with a return path; operators page; document operators panel on the dashboard; sign-out.
4. Regenerate SKILL.md; rebuild the committed bundle; update `docs/operations.md` (bootstrap operator, Postmark prerequisite, GitHub webhook setup for `refresh`, how a bot operator signs in once).
5. Tests: CLI e2e against the in-process API using the dev shortcut to approve the device code; component tests for the three new pages and the guard.

## Validation

- [x] `drafter-axi login <email> --url <local api>` completes the device-code flow (approval driven by a test) and writes a 600-mode profile file containing the URL; the next command, run with no `DRAFTER_URL` in the environment, authenticates against that URL and `whoami` shows the operator and expiry. Without `--url` or `DRAFTER_URL`, `login` exits 2 with a hint. (`packages/cli/src/e2e.test.ts`; re-verified by hand against a real local instance — see Notes)
- [x] A token older than 30 days is refreshed silently before a command; a deactivated operator's refresh fails with a clear message. (`packages/cli/src/e2e.test.ts`, using `mintOperatorToken`'s new `issuedAt` override)
- [x] `operators add/update/remove` and `docs operators add/remove` round-trip against the API and print commit subjects; removing the last operator is refused with the API's message. (`packages/cli/src/e2e.test.ts`; re-verified by hand)
- [x] `/admin` without a session redirects to `/admin/login`; the login page never reveals whether an email is an operator; the device page approves a pending code for the signed-in operator only. (`apps/web/src/admin/AdminLayout.test.tsx`, `LoginScreen.test.tsx`, `DeviceApprovalScreen.test.tsx`; re-verified by hand)
- [x] The document list shows only the operator's documents; the operators page and the document operators panel perform their actions with confirmations and show commit subjects. (`OperatorsScreen.test.tsx`, `DocumentOperatorsPanel.test.tsx`; re-verified by hand, including the `last_operator` refusal shown verbatim)
- [x] SKILL.md and the bundle are regenerated (drift gate green); the runbook documents bootstrap, Postmark, webhook and bot sign-in. (`packages/cli/src/build.test.ts`; `docs/operations.md`)

## Risks / unknowns

- **Bot sign-in UX**: a bot's first login needs a human to open the bot mailbox's magic link once; the runbook must say so plainly.

## Notes

- Bun's `os.homedir()` ignores a runtime-mutated `process.env.HOME` (unlike Node, which checks `$HOME` first on POSIX) — `config.ts`'s `configDir()` now checks `process.env.HOME` explicitly before falling back to `homedir()`, which is also what let the e2e suite sandbox the profile directory per test without touching the real `~/.config/drafter`.
- The device-code poll loop's 15-minute ceiling and expired/unknown-code path are implemented per spec but not exercised end-to-end by an automated test (would need a real 15-minute wait or fake timers) — same treatment `operators-auth` gave the server-side store's expiry, tracked there as accepted given the logic is small and self-contained.
- `vite.config.ts` needed a real fix, not just an addition: the dev proxy had no `/auth/*` entries at all before this plan (the old Google sign-in link was a full-page navigation, so the gap was latent), and a first attempt at a blanket `/auth` prefix broke `GET /auth/device?code=` — the SPA's own `DeviceApprovalScreen` route — by handing it to the API instead. Fixed by proxying each real server route individually. Caught by the manual browser walkthrough, not by a component test (component tests render in isolation and never see Vite's dev proxy).
- Did a full manual walkthrough against a real local instance (temp bare data repo, `DEV_ADMIN_EMAIL`/`BOOTSTRAP_OPERATOR_EMAIL`, `MAILER=export`) covering: `/admin/login` → magic-link callback → signed in; `drafter-axi login` racing a browser approval on `/auth/device`; `docs create`/`whoami`/`operators add` from the freshly-signed-in CLI; the dashboard's operators panel (add/remove/last-operator refusal); `/admin/operators` (self row correctly disabled); sign-out redirect.

## Follow-ups

None.
