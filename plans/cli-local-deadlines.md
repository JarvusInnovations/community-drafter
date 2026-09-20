---
status: done
pr: 61
depends: []
specs:
  - specs/api/admin-cli.md
---

# Plan: cli-local-deadlines

## Scope
Let `docs open`, `docs extend` and `docs reopen` take a deadline as a zone-less local time as well as zoned ISO 8601, resolve it on the operator's machine, and echo the resolved instant. The API keeps requiring zoned input (PR #49). Out: a per-document time zone on the server.

## Implements
- `specs/api/admin-cli.md` — the `<when>` form.

## Approach
1. `packages/cli/src/cli/deadline.ts`: `parseDeadline` accepts `…Z` / `…±hh:mm` (normalized to UTC) or `YYYY-MM-DD[T ]HH:MM[:SS]` (read as local time), returns the UTC ISO and a one-line note; anything else is a usage error listing the three forms.
2. The three commands send the resolved ISO and print the notes.

## Validation
- [x] Unit tests: zoned pass-through, local resolution, rejection with the accepted forms in the message.
- [x] `docs open` with `--comments-close 2026-10-01T17:00` succeeds and prints "read as America/New_York → … (…Z)".

## Risks / unknowns
- A machine in a different zone from the document's audience resolves differently; the note makes the chosen zone visible.

## Notes
- Follows the operator personas' first ask on deadlines in the 2026-09-20 simulated run (#43/#44 fixed the 500; this fixes the typing).

## Follow-ups
- None.
