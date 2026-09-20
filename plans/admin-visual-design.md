---
status: planned
depends: []
specs:
  - specs/screens/admin-dashboard.md
---

# Plan: admin-visual-design

## Scope
Restyle every `/admin/*` page and `/auth/device` to `screens/admin-dashboard.md` § Design: top bar with navigation and sign-out, cards, the funnel, stat tiles, tables with status pills and filter toolbars, submission cards with disposition pills, dialogs, the sign-in and device pages, the view-as banner. Out: any behavior change; new admin features.

## Implements
- `specs/screens/admin-dashboard.md` — § Design.

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
