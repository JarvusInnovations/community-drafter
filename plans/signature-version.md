---
status: done
depends: []
specs:
  - specs/behaviors/signatures.md
  - specs/screens/document.md
  - specs/screens/admin-dashboard.md
  - specs/data-model.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
issues: [67]
pr: 86
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

- [x] The nurses' document scenario (four signatures on v2, v3 published) shows the drift line to each signer and the count to the operator. Verified in the browser at 390 and 1280 against a throwaway temp data repo: each signer's card carried "The text has changed since you signed (now version 3)" with the comparison defaulted to v2 → v3; the dashboard read "Behind current 3" after one signer kept her name, the people table showed "personal · v2 / behind v3" on the other three, and `signatures list` / `docs show` reported the same numbers.
- [x] Existing tests pass; new tests as above. 352 pass, 0 fail across all four packages (16 new: 8 API, 3 StatusCard, 3 dashboard, 3 people table). `lint`, `format:check`, `typecheck` green everywhere; `apps/web` builds at 105.18 KB gzip against the 120 KB budget.
- [x] #67 closed by the PR (PR #86). Its second point — emailing signers when a non-final version changes the body — was explicitly out of scope here and is carried forward below.

## Risks / unknowns

- Older participations without the field rely on the trailer backfill; verify against the sim data repo.

## Notes

- **The field already existed; nothing read it.** `signature.signed_on_version` was written on every sign. The work was almost entirely in reading it back, moving it, and saying it — which is what made the issue possible: the product knew and did not tell.
- **Re-affirmation is one action with two labels.** The plan sketched "Keep" as a `submit` with the newer `Version`. Implemented instead as the existing `PATCH /signature {confirm: true}`, which already re-affirms for a final version: one commit (`sign: … (reaffirmed v3)`), no phantom comment-less submission record on the signer's "Your submissions" list, and one re-affirmation button ever — "Confirm my signature" on a final version, "Keep my name" otherwise. Comment mode's "keep" still goes through `submit` exactly as `signatures.md` § Signing describes, and that path now advances the version too.
- **Version moves forward only.** A `sign`/"keep" submission against an older version (someone still commenting on v2 after v3 published) must not drag a v3 signature backwards; `submit.ts` takes the max. Worth remembering when the comment-mode rebase work lands.
- **The backfill never writes.** A record predating the field derives its version from the `Version` trailer of the commit behind the signature in force. A listing edit deliberately does *not* persist the derived number — the derivation stays the single story for those records, and the edit's own `sign` commit carries the same trailer so it stays stable.
- **Only the signer moves their name.** Publishing a version, an operator action, and a listing edit all leave `signed_on_version` alone. That rule is in the spec, not just the code.

## Follow-ups

- **Issue** — #67's second point: publishing a non-final version that alters the body should tell signers, or the operator should have to acknowledge that it will not (`signers: 0` currently prints as a success line). Out of scope here by the plan's own Scope; needs the notification design, not this plan's data work.
- **Deferred to plan** — one-line email to signers when a new version touches a section they commented on (needs anchor-to-section mapping on publish).
- **Deferred to plan** — `audience-and-consent` rewrites the sign form and the signed-state card next; it already `depends: [signature-version]` and needs no amendment from this work.
