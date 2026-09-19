---
status: planned
depends: [api-core]
specs:
  - specs/screens/document.md
  - specs/screens/version-history.md
  - specs/behaviors/signatures.md
  - specs/behaviors/document-lifecycle.md
---

# Plan: participant-sign-flow

## Scope
The React app's participant routes for reading and signing: `/i/:token` (status card in every state, clock, version label, document body, signatories, footer), `/i/:token/v/:n`, `/i/:token/history` and `/compare`. The SPA shell served by the API. Out: comment mode (→ `comment-mode`), preferences page (→ `notifications`), public routes (→ `public-and-embed`).

## Implements
- `specs/screens/document.md` — all display rules and actions except "I have comments first"/"Add comments" navigation targets (rendered as links; the target lands in `comment-mode`).
- `specs/screens/version-history.md` — list, read, compare.
- `specs/behaviors/signatures.md` — the sign card, capacity fields, attestation, descriptor copy, own-status line, signatory list rendering.
- `specs/behaviors/document-lifecycle.md` — the visible clock and phase messaging.

## Approach
1. Load `jarvus-react`. Route family `/i/:token/*` with a loader that fetches the bundle once and shares it; error boundary renders the "link isn't available" page for 404.
2. Status card as a state machine over `{ phase, signature, position, draft }` matching the six states in the screen spec; all copy strings in one module so the reassurance line and deadline phrasing are reviewable.
3. Clock component: absolute time with zone name + relative countdown; live within 24 h.
4. Document body injected from `bundle.version.html`; signatories component shared with `public-and-embed`.
5. History and compare views consume the API's block-status array; "hide unchanged" toggle in URL state.
6. Bundle budget check in CI (`vite build` size assertion for the participant entry).

## Validation
- [ ] Phone-width screenshot shows title, clock and the sign button above the fold without scrolling.
- [ ] Each of the six status-card states renders from fixture bundles (storybook-style fixture routes or component tests).
- [ ] Sign → card flips to *Signed* with the sign date; Remove my name → confirmation → *Not signed* with the removal date; both reflect server state after reload.
- [ ] Official capacity cannot be submitted without the attestation checkbox; personal capacity shows the descriptor field with the specified prompt.
- [ ] Older version view shows the banner and links to the current version; compare view shows the redline and summary line with a working unchanged-blocks toggle.
- [ ] Participant entry JS is under 120 KB gzipped on first load (CI assertion).
- [ ] The route works with third-party cookies and local storage disabled (manual check in a private window and inside an iframe test page).

## Risks / unknowns
- **Time-zone display** — the participant's zone comes from the browser; emails (later) use the document zone; make sure both say which.

## Notes
(closeout)

## Follow-ups
(closeout)
