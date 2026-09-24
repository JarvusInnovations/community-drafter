---
status: done
depends: []
specs:
  - specs/screens/admin-dashboard.md
pr: 36
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

- [x] Every bullet of the spec's § Design is visibly implemented at 390 and 1280 px (verified via a `chrome-devtools-axi` walkthrough against a locally seeded API + the built web app; screenshots captured locally rather than embedded in the PR, matching PR #32's convention).
- [x] Existing component and e2e tests pass unchanged (70/70 web, 152/152 api, 37/37 cli, 24/24 shared; all 8 CI checks on PR #36 green).
- [x] No horizontal overflow at 390 px; participant entry bundle unchanged or smaller (95.14 KB gzip of the 120 KB budget, same as before this plan — admin is lazy-loaded and doesn't touch the participant entry chunk).

## Risks / unknowns

- **Phone bottom sheet** (comment mode) is the one piece with real interaction work; keep it CSS-first (sticky bottom card with a scrollable body) rather than a gesture library. (N/A to this plan — comment mode is `comment-mode-visual-design`'s scope, not admin's.)

## Notes

- Added a shared `DialogShell` (`apps/web/src/admin/components/DialogShell.tsx`) that all four admin dialogs (`ConfirmDialog`, `ReasonDialog`, `ExtendDeadlineDialog`, `OperatorFormDialog`) now build on, plus `Card`, `Pill`, and `Funnel`/`FunnelBar`/`StatTile` primitives and a `styles.ts` of shared input/button/chip class strings — the plan's "three or more screens" bar for a shared primitive.
- Found and fixed a real centering bug in the process: Tailwind's preflight strips the native `<dialog>` element's default UA centering, so every admin dialog was rendering pinned to the top-left corner before this restyle added explicit `fixed inset-0 m-auto` centering to `DialogShell`.
- Found and fixed a real horizontal-overflow bug during the 390 px walkthrough: the document-family tab row (Dashboard/People/Submissions/Versions in `DocumentLayout.tsx`) doesn't wrap, and was widening the whole page past 390px; it now scrolls within its own bounded row (`overflow-x-auto` on the nav, not the page).
- The top bar's instance name is a static "Community Drafter" fallback literal (`copy.instanceName`) rather than the real configured value — no admin-facing endpoint exposes `INSTANCE_NAME` yet, and adding one is a backend change out of scope for a visual-only restyle. Filed as Issue #37.
- Discovered (not fixed) a pre-existing wire-format mismatch: the API's `participationStatus()` emits the literal `"signed (conditional)"`, not this repo's `ParticipationStatus` type's `signed_conditional`. `PeopleScreen.tsx`'s status→pill mapping was made defensive (raw string in, muted-pill fallback for anything unrecognized) so this restyle wouldn't crash on it. Filed as Issue #38.
- Seeded a local `coalition-charter` document (via a scratch script, not committed) with five participants covering signed, signed-conditional, drafting, commented, and declined statuses to drive the screenshots. Noted for whoever does this next: `fastify.storage.commit()`'s "incremental refresh" didn't pick up `participations.patch()` writes made outside the normal route handlers, so the read model needed an explicit `readModel.build()` call after seeding before the API reflected the seeded data.

## Follow-ups

- Issue [#37](https://github.com/JarvusInnovations/community-drafter/issues/37) — expose the configured `INSTANCE_NAME` to the admin frontend so the top bar shows it instead of the static fallback.
- Issue [#38](https://github.com/JarvusInnovations/community-drafter/issues/38) — reconcile the `ParticipationStatus` wire mismatch (`signed_conditional` vs the API's `"signed (conditional)"`).
