---
status: planned
depends: [participant-sign-flow]
specs:
  - specs/screens/public-and-embed.md
---

# Plan: public-and-embed

## Scope

The `/d/:slug` route family: public read view, public history and compare, `embed`, `signatories` page, `signatories.json`, and `widget.js`. Frameability headers per route. Out: **[phase 2]** participate flow (magic links).

## Implements

- `specs/screens/public-and-embed.md` — all phase-1 rules.

## Approach

1. Public API routes (`public` capability) returning the same bundle shape minus person-specific fields, gated on `public_access` and `state`. The `public` capability itself already exists (`api-core`'s `apps/api/src/gateway/capability.ts` `PUBLIC_ROUTE` constant, currently only declared on `GET /_health`) — declare it on every `/d/:slug/*` route rather than reintroducing the concept; `computeSignatories` (`api-core`'s `lib/signatories.ts`) and the render/diff cache (`rendering/cache.ts`) are reusable as-is for `signatories.json` and the public compare view.
2. SPA routes reusing the document body, clock, history and signatories components; the "ask the team" card in place of the status card.
3. Embed route: minimal chrome, `postMessage` height reporting, `frame-ancestors *` for embed and signatories only; `DENY` elsewhere including every `/i/*` route.
4. `widget.js`: plain script under 3 KB rendering counts into `[data-drafter-doc]`, polling every 5 minutes, silent on failure.

## Validation

- [ ] `/d/<slug>` 404s when `public_access = none` or `state = draft`, with the same body as an unknown slug.
- [ ] Embedding `/d/<slug>/embed` in a test page on another origin works and resizes; embedding `/i/<token>` is blocked by the browser.
- [ ] `signatories.json` counts match the participant bundle's counts for the same document.
- [ ] `widget.js` is under 3 KB, renders the counts sentence, and renders nothing when the JSON endpoint returns 404.

## Risks / unknowns

- **CORS + caching** — `signatories.json` needs a short cache header so counts move within minutes without hammering the instance.

## Notes

(closeout)

## Follow-ups

(closeout)
