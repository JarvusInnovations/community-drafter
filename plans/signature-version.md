---
status: planned
depends: []
specs:
  - specs/behaviors/signatures.md
  - specs/screens/document.md
  - specs/screens/admin-dashboard.md
  - specs/data-model.md
---

# Plan: signature-version

## Scope

Decision of 2026-09-20: store which version a signature was made on and show it (#67). The signer's card says "You signed version 2 on …"; when the current version is newer, a quiet line says the text has changed since, with the "see what changed" link; the team's people table and signatures list show the version and flag drift. Out: emailing signers on every version (kept to the final-version rules), which is a follow-up once the section-touch heuristic exists.

## Implements

- `specs/data-model.md` — `signature.version` (the version number seen when signing or last re-affirming) is the stored field; the `Version` trailer already carries it on the commit.
- `specs/behaviors/signatures.md` — "A signature belongs to a version" rule: set on sign, updated on `sign`/"keep" via submit and on "Confirm my signature".
- `specs/screens/document.md` — Display Rules 3 signed state wording; the drift line.
- `specs/screens/admin-dashboard.md` — People table: "signed v2" and a drift marker when behind the current version; dashboard tile "signatures behind current".

## Approach

1. Read model and shared types: expose `signature.version`; backfill from the `Version` trailer of the last `sign`/`submit`/confirm commit when the field is absent in older records (read-only derivation, no migration commit).
2. Participant card: "You signed version 2 on Sun, Sep 20 · 2:12 PM EDT as …"; when `bundle.version.number > signature.version`: "The text has changed since you signed (now version 3). See what changed · Keep my name · Remove my name", where Keep records a `submit` with the newer `Version` (per `signatures.md`).
3. Admin: people table column and pill; dashboard tile; `signatures list` column.
4. Tests: sign on v1, publish v2, card shows drift; Keep clears it; conditional and plain both carry the version.

## Validation

- [ ] The nurses' document scenario (four signatures on v2, v3 published) shows the drift line to each signer and the count to the operator.
- [ ] Existing tests pass; new tests as above.
- [ ] #67 closed by the PR.

## Risks / unknowns

- Older participations without the field rely on the trailer backfill; verify against the sim data repo.

## Notes

(closeout)

## Follow-ups

- One-line email to signers when a new version touches a section they commented on (needs anchor-to-section mapping on publish).
