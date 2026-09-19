---
status: planned
depends: [operators-auth]
specs:
  - specs/api/admin-cli.md
  - specs/screens/admin-dashboard.md
  - specs/behaviors/operators.md
---

# Plan: operators-cli-and-dashboard

## Scope
The human and agent surfaces for operators: `drafter-axi login` (device code) / `logout` / `whoami`, profile-file token storage with silent refresh, `operators *` and `docs operators *` verbs, removal of `--owner` and `--actor`; the dashboard's sign-in page, device-approval page, operator-scoped document list, operators page, and the per-document operators panel. Also updates the skill's SKILL.md and the runbook. Out: the API (→ `operators-auth`).

## Implements
- `specs/api/admin-cli.md` — configuration, `login`/`logout`/`whoami`, `operators *`, `docs operators *`, `docs create` without `--owner`.
- `specs/screens/admin-dashboard.md` — sign-in, device approval, scoped list, operators page, document operators panel, sign-out.
- `specs/behaviors/operators.md` — the CLI device-code flow and the "any current operator may add operators" rule as exercised from both surfaces.

## Approach
1. CLI: `login <email>` → `POST /auth/device`, print the user code and the "check your email" line, poll `token` at the returned interval until approved or expired; write `~/.config/drafter/<profile>.toml` (mode 600) with `url`, `token`, `email`, `expires_at`; before each command, if the token is older than 30 days call `refresh` and rewrite the file; `DRAFTER_TOKEN` env overrides; home view without a token explains `login`.
2. Operators and document-operator commands over the new endpoints; every mutation prints the commit subject.
3. Web: `/admin/login` form; `/auth/device` approval page; route guard redirecting to login with a return path; operators page; document operators panel on the dashboard; sign-out.
4. Regenerate SKILL.md; rebuild the committed bundle; update `docs/operations.md` (bootstrap operator, Postmark prerequisite, GitHub webhook setup for `refresh`, how a bot operator signs in once).
5. Tests: CLI e2e against the in-process API using the dev shortcut to approve the device code; component tests for the three new pages and the guard.

## Validation
- [ ] `drafter-axi login` against a local API completes the device-code flow (approval driven by a test) and writes a 600-mode profile file; the next command authenticates with it and `whoami` shows the operator and expiry.
- [ ] A token older than 30 days is refreshed silently before a command; a deactivated operator's refresh fails with a clear message.
- [ ] `operators add/update/remove` and `docs operators add/remove` round-trip against the API and print commit subjects; removing the last operator is refused with the API's message.
- [ ] `/admin` without a session redirects to `/admin/login`; the login page never reveals whether an email is an operator; the device page approves a pending code for the signed-in operator only.
- [ ] The document list shows only the operator's documents; the operators page and the document operators panel perform their actions with confirmations and show commit subjects.
- [ ] SKILL.md and the bundle are regenerated (drift gate green); the runbook documents bootstrap, Postmark, webhook and bot sign-in.

## Risks / unknowns
- **Bot sign-in UX**: a bot's first login needs a human to open the bot mailbox's magic link once; the runbook must say so plainly.

## Notes
(closeout)

## Follow-ups
(closeout)
