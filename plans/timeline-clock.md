---
status: planned
depends: []
specs:
  - specs/screens/document.md
  - specs/behaviors/document-lifecycle.md
---

# Plan: timeline-clock

## Scope
Replace the text-only phase line on the participant and public document headers with the timeline component: track, three labeled points, now marker, two live countdown chips. Out: comment mode's top bar (keeps the one-line form), emails.

## Implements
- `specs/screens/document.md` — Header § Timeline.
- `specs/behaviors/document-lifecycle.md` — The visible clock.

## Approach
1. `Timeline.tsx` in the participant components, pure over `{ phase, opened_at, comments_close_at, signing_closes_at }` plus `now`; positions proportional to time with a 28% minimum per segment; states done/active/pending encoded as fill + label; two `useCountdown` instances.
2. Use it from `DocumentHeader` and `PublicDocumentHeader`; keep `PhaseLine` for comment mode.
3. Component tests for commenting, signing, closed, withdrawn and not-yet-open from fixture documents; snapshot of chip text.

## Validation
- [ ] The three phases render the correct active segment and chip texts from fixtures; a passed deadline reads "closed", never a negative countdown.
- [ ] No color-only state: segment states are distinguishable in a grayscale screenshot.
- [ ] Phone width (390 px) shows the full track and both chips without horizontal overflow.
- [ ] Bundle-size check still passes.

## Risks / unknowns
- **Missing `opened_at`** on documents opened before the field existed: fall back to the first version's publish time.

## Notes
(closeout)

## Follow-ups
(closeout)
