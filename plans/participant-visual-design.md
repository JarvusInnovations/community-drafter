---
status: planned
depends: []
specs:
  - specs/screens/document.md
  - specs/screens/marketing-site.md
---

# Plan: participant-visual-design

## Scope
Restyle the live participant document screen (and the public read view, which shares its parts) to the chosen design: tokens, sticky top bar with the phase pill, rail timeline, two-column layout with a sticky action panel and the phone bottom bar, the document and signatories cards, the footer. Then re-capture the homepage screenshots. Out: comment mode's tray and the admin dashboard beyond inheriting the tokens; the history/compare screens beyond the frame.

## Implements
- `specs/screens/document.md` — § Design.
- `specs/screens/marketing-site.md` — screenshots reflect the live app.

## Approach
1. Tokens in `apps/web/src/index.css` (`--color-*` for page, card, ink, muted, line, primary, primary-soft, primary-deep, ok, ok-soft, amber, amber-soft) with a dark-scheme override; body background and font stack.
2. `ParticipantLayout`: sticky top bar (instance name + phase pill from the bundle); container width.
3. `DocumentView`: grid with the action panel first in DOM (sticky on wide screens), document card, signatories card, footer; a `StickySignBar` shown on narrow screens while the panel is out of view (IntersectionObserver).
4. `Timeline`: chips + rail styling per the design; `StatusCard`/`SignForm`: segmented capacity control, inputs, primary button, amber note; `VersionLabel`: chip form; `Signatories`: avatars + chip grid; `Footer`.
5. Public `DocumentScreen`/`PublicDocumentHeader` reuse the same parts with the "ask the team" card in the panel slot.
6. Re-run the existing component tests (copy unchanged), bundle-size check, browser check at 390 and 1280, deploy, re-capture `site/img/*.png`, republish Pages.

## Validation
- [ ] Phone (390 px): action panel above the document, sticky bottom bar appears only after the panel scrolls away, no horizontal overflow.
- [ ] Desktop (1280 px): document card left, sticky panel right, timeline chips + rail above both.
- [ ] Existing tests pass unchanged; participant entry stays under the bundle budget.
- [ ] Homepage screenshots re-captured from the live app and Pages republished.

## Risks / unknowns
- **Dark scheme** gets the same roles but was not mocked; keep contrast honest rather than pretty.

## Notes
(closeout)

## Follow-ups
(closeout)
