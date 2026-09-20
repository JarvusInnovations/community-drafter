---
status: planned
depends: []
specs:
  - specs/screens/comment-mode.md
---

# Plan: comment-mode-visual-design

## Scope
Restyle comment mode to `screens/comment-mode.md` § Design: the second bar, the document card with the two highlight styles and the floating Comment button, the review tray as a sticky card / phone bottom sheet with state badges and judgement rows, the composer, the mismatch and phase-closed notices. Out: any behavior change; the participant document screen (done).

## Implements
- `specs/screens/comment-mode.md` — § Design.

## Approach
1. Reuse the tokens and the shared pieces already in `apps/web` (top bar, cards, buttons, chips, the `Timeline` component); add small shared primitives only where three or more screens need them (a `Pill`, a `Card`, a `Dialog` shell).
2. Restyle screen by screen against the spec's bullets; keep every copy string and every test selector unchanged.
3. Browser walkthrough at 390 and 1280 px; bundle-size check.

## Validation
- [ ] Every bullet of the spec's § Design is visibly implemented at 390 and 1280 px (screenshots in the PR).
- [ ] Existing component and e2e tests pass unchanged.
- [ ] No horizontal overflow at 390 px; participant entry bundle unchanged or smaller.

## Risks / unknowns
- **Phone bottom sheet** (comment mode) is the one piece with real interaction work; keep it CSS-first (sticky bottom card with a scrollable body) rather than a gesture library.

## Notes
(closeout)

## Follow-ups
(closeout)
