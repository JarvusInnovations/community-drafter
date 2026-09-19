---
status: done
pr: 24
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
- [x] The three phases render the correct active segment and chip texts from fixtures; a passed deadline reads "closed", never a negative countdown (`Timeline.test.tsx`).
- [x] No color-only state: done is solid, active is striped, pending is empty; verified on the live page screenshot.
- [x] Phone width (390 px) shows the full track and both chips without horizontal overflow (live screenshot after deploy).
- [x] Bundle-size check still passes (93.3 KB gzip of 120 KB).

## Risks / unknowns
- **Missing `opened_at`** on documents opened before the field existed: fall back to the first version's publish time.

## Notes
- The now marker sits near the left edge early in a comment period because positions are proportional to time; that is intended and reads correctly once a day or two has passed.

## Follow-ups
None.
