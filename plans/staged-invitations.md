---
status: done
pr: 75
depends: []
specs:
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/data-model.md
  - specs/screens/admin-dashboard.md
---

# Plan: staged-invitations

## Scope

Make "build the list, review it, then send" a first-class workflow for an operator or their agent: a dry run on import that shows what every row would do (new person, existing person and which fields change, already invited), a way to take back a staged invitation that was never sent, a dry run on send that lists who would receive one and who is skipped and why, and a visible `not_sent` status so a staged list reads as staged. Duplicate protection is unchanged (`sent_at` and `notified.invitation` guard every send path). Out: reminder throttling (#58), the people-model question (#51).

## Implements

- `specs/api/admin.md` — import `dry_run`, `DELETE .../invitations/:person`, send `dry_run` and `skipped`, `not_sent` in the list.
- `specs/api/admin-cli.md` — `people import --dry-run`, `people remove`, `people send --dry-run`, `--status not_sent`.
- `specs/data-model.md` — `not_sent` at the head of the derived status; `uninvite` action.
- `specs/screens/admin-dashboard.md` — the status in the people table and its pill.

## Approach

1. Import computes a read-only plan first and returns it always (`rows`); with `dry_run=1` it stops there.
2. `DELETE /invitations/:person` removes the participation in an `uninvite` commit when nothing has happened yet (409 `already_sent` / `has_activity` otherwise); the person record stays.
3. Send computes candidates and skip reasons once; `dry_run` returns them without writing or mailing; a real send returns `skipped` alongside `queued`.
4. `participationStatus` yields `not_sent` before `unopened`; the web pill and CLI filter follow.

## Validation

- [x] Dry-run import leaves the commit count and the read model unchanged and reports per-row actions.
- [x] Remove works on a staged invitation and is 409 once sent; the person record survives.
- [x] Send dry run lists would-send and skipped with reasons and marks nothing; a real send reports `skipped`.
- [ ] Live: `people import --dry-run`, `people send --dry-run` and `people remove` against a scratch document.

## Risks / unknowns

- `not_sent` is a new value in the status vocabulary; older CLI bundles print it as a plain string, which is fine.

## Notes

(closeout)

## Follow-ups

- Reminder throttle and honest `targeted` count (#58).
