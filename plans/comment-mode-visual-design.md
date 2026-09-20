---
status: done
depends: []
specs:
  - specs/screens/comment-mode.md
pr: 34
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

- [x] Every bullet of the spec's § Design is visibly implemented at 390 and 1280 px (screenshots in PR #34).
- [x] Existing component and e2e tests pass unchanged (70 web tests; 283 total across the workspace).
- [x] No horizontal overflow at 390 px (`scrollWidth === innerWidth === 390`); participant entry bundle 95.02 KB gzip of 120 KB (unchanged from `participant-visual-design`'s baseline).

## Risks / unknowns

- **Phone bottom sheet** (comment mode) is the one piece with real interaction work; keep it CSS-first (sticky bottom card with a scrollable body) rather than a gesture library.

## Notes

- The review tray is one component with two responsive shells switched by Tailwind breakpoint classes on the same wrapping `<aside>` (sticky 360px column at `lg`, fixed bottom sheet with a drag handle and pinned header below `lg`) rather than two rendered instances — avoids the `judgement`/`signature` local state in `ReviewTray` diverging between a desktop and a mobile copy.
- `JudgementPicker`'s selected-row styling moved from a manual `value === judgement` class check to Tailwind's `has-checked:` variant, matching `SignForm`'s capacity toggle — one less piece of state-derived className logic.
- The floating "Comment" button/composer now anchor by `bottom` (computed from `window.innerHeight - rect.top`) instead of `top: rect.bottom`, per the spec's "anchored just above the selection" — the only non-className behavior-adjacent change, and still purely positional.
- Browser walkthrough used a temp local API (temp git data repo, `MAILER=export`) plus the Vite dev server, driven by `chrome-devtools-axi` in a dedicated new browser tab. The shared browser instance already had unrelated tabs open, including a live production `drafter.jarv.us` document with real sign/revoke actions (left over from a prior session's work, per `participant-visual-design`'s "re-capture the homepage screenshots" note) — left entirely untouched; all interaction happened in a fresh tab closed at the end.

## Follow-ups

None.
