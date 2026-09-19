---
status: done
pr: 16
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

- [x] `/d/<slug>` 404s when `public_access = none` or `state = draft`, with the same body as an unknown slug. (`apps/api/src/routes/public/context.test.ts`; also checked across `signatories.json` and `widget.js`.)
- [x] Embedding `/d/<slug>/embed` in a test page on another origin works and resizes; embedding `/i/<token>` is blocked by the browser. (Manual check: a built API server + host HTML page on a different port; the embed iframe rendered and reported height via `postMessage` three times as content settled, the `/i/<token>` iframe was refused to connect by Chrome.)
- [x] `signatories.json` counts match the participant bundle's counts for the same document. (`apps/api/src/routes/public/signatories.test.ts`.)
- [x] `widget.js` is under 3 KB, renders the counts sentence, and renders nothing when the JSON endpoint returns 404. (`apps/web/src/public/widget.test.ts`; 2278 bytes raw, no separate minify step.)

## Risks / unknowns

- **CORS + caching** — `signatories.json` needs a short cache header so counts move within minutes without hammering the instance.

## Notes

- `computeSignatories` (`apps/api/src/lib/signatories.ts`) grew an additive `updated_at` field (the latest sign/resign among current signatories) so the public signatories page/JSON could show a last-updated time without a second query; participant bundle callers are unaffected.
- `signatories.json` 404s (rather than returning zeroed counts) when the document's own `show_signatories = "none"` — "shows nothing to the public" is treated as "this endpoint isn't available," not a misleading `200`. `widget.js` degrades identically on either 404 (unauthorized document vs. hidden signatories).
- The plan's "reusing ... history and signatories components" was read at the level of low-level presentational pieces (`DocumentBody`, `Signatories`, `PhaseLine`), not the participant `HistoryScreen`/`CompareScreen`/`VersionLabel`/`Footer` themselves — those hard-code `/i/:token` paths and token-keyed API calls throughout, so public equivalents were written instead under `apps/web/src/public/`. `PhaseLine`'s prop type was narrowed to just the fields it reads (a backward-compatible change) so the public document shape — no `capacities` — passes straight through.
- No public route reads a single older version standalone (no `/d/:slug/v/:n`): the spec's public route table has no such route, so public history offers only "compare with previous," matching the table exactly.
- CORS is a hand-set `access-control-allow-origin: *` header on the two routes that need it (`signatories.json`, `widget.js`), not `@fastify/cors` — simpler for two routes and avoids a new dependency.

## Follow-ups

- Real cross-origin fetch of `signatories.json`/`widget.js` from a genuinely different-origin page's JS (not just the manual iframe embed check) is unverified — headers were confirmed via `curl` and the CSP/CORS logic via automated tests, but no live third-party-origin `fetch()` was exercised.
- **[phase 2]** the "participate" flow (`public_access = participate`, magic links, the sign-or-comment card) is explicitly out of scope here, per the plan and spec.
