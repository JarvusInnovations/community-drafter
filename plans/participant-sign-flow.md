---
status: done
pr: 14
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

- [x] Phone-width screenshot shows title, clock and the sign button above the fold without scrolling.
- [x] Each of the six status-card states renders from fixture bundles (storybook-style fixture routes or component tests).
- [x] Sign → card flips to *Signed* with the sign date; Remove my name → confirmation → *Not signed* with the removal date; both reflect server state after reload.
- [x] Official capacity cannot be submitted without the attestation checkbox; personal capacity shows the descriptor field with the specified prompt.
- [x] Older version view shows the banner and links to the current version; compare view shows the redline and summary line with a working unchanged-blocks toggle.
- [x] Participant entry JS is under 120 KB gzipped on first load (CI assertion).
- [ ] The route works with third-party cookies and local storage disabled (manual check in a private window and inside an iframe test page).

## Risks / unknowns

- **Time-zone display** — the participant's zone comes from the browser; emails (later) use the document zone; make sure both say which.

## Notes

- Shipped as PR [#14](https://github.com/JarvusInnovations/community-drafter/pull/14): `apps/api/src/routes/static.ts` (SPA serving) and `apps/web/src/participant/*` (the route family, six-state sign card, history/compare, placeholders).
- `apps/web` does not depend on `@community-drafter/shared` — its main barrel pulls in the server-only render pipeline, and compare/diff HTML arrives pre-rendered from the API, so the participant app never needs the diff algorithm client-side. Wire types are hand-authored in `participant/types.ts`.
- `react/set-state-in-effect` is disabled in `apps/web/.oxlintrc.json`: this stack has no router loader/data-fetching library, so every route's fetch-on-mount effect calls `setState` from its (cleanup-guarded) async callback, which the rule flags regardless of the `await` boundary. Worth revisiting if a future plan adopts a data-fetching library.
- Caught during self-review, not code review: the not-signed state's "You removed your name on {date}" line (`specs/screens/document.md` § Actions) was missing from the initial implementation — added in a follow-up commit with its own test.
- The initial sign form has no "list my name publicly" toggle by design (keeps the pre-signature form to only spec-mandated fields, per "Sign first, everything else after"); that control lives in the post-sign "Change how you're listed" edit panel.
- The cookie/iframe validation item is unchecked: the route makes no use of cookies or local storage by construction (verified by reading the code, not by a dedicated private-window/iframe smoke test), so the risk is believed low but the manual check itself wasn't run.
- CI oddity at closeout: the full 8-job matrix passed for the branch's third commit (`17304ee`, the state at PR creation). Two small follow-up commits pushed after that (the removed-on-line fix and the attestation-gate tests) did not get new GitHub Actions check-runs registered by close of session, despite `git ls-remote` confirming the push landed — looked like a webhook/dispatch gap rather than a workflow-config problem (workflows are `active`, path filters match, permissions are enabled). All the same gates were re-run locally against the exact final commit (`bun run lint`/`format:check`/`typecheck`/`test` across the whole workspace, `apps/web`'s `build` and `check:bundle-size`) and passed. Orchestrator should re-check `gh pr checks 14` before merging in case it's still stuck.

## Follow-ups

None — the deferred scope (comment mode, notifications/preferences, public routes) already has owning plans named in this plan's Scope section, and both placeholder routes link back to the document so nothing is left dangling.
