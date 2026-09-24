---
status: done
pr: 4
depends: [workspace-bootstrap]
specs:
  - specs/behaviors/versioning.md
  - specs/behaviors/inline-comments.md
---

# Plan: render-and-diff

## Scope

Pure, framework-free algorithms in `packages/shared`: the unified markdown pipeline with sanitization and block identity, the block-aligned word-level redline between two texts, and the anchor computation and re-anchoring functions (from DOM in the browser, from text in tests). Out: any UI, any storage.

## Implements

- `specs/behaviors/versioning.md` — *Diff*, the rendering used by the label and history.
- `specs/behaviors/inline-comments.md` — *Block identity*, *Anchor shape*, *Re-anchoring on display* (as functions; capture wiring lands in `comment-mode`).

## Approach

1. Pipeline: `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-sanitize`, `rehype-slug`, project `rehype-block-ids` (NFC + whitespace-collapsed text hash, 8 hex, ordinal suffix on collision), `rehype-stringify`. Export `render(markdown) → { html, blocks: [{id, text, headingPath}] }`.
2. Diff: align blocks by id, then LCS over normalized text with a similarity threshold for changed pairs, then `diff`'s word diff inside changed pairs; emit `[{status, id, html}]` plus the summary counts; formatting-only changes flagged, not redlined.
3. Anchors: `computeAnchor(selection, blocks)`; `placeAnchor(anchor, blocks) → { blockId, start, length } | null` implementing the four-step re-anchoring with the score rule and the short-quote guard.
4. Golden tests: fixtures of real charter-like prose across three revisions; assert block-id stability for untouched paragraphs, redline output, and anchor placement/non-placement cases.

## Validation

- [x] Untouched paragraphs keep identical `data-block` ids across two renders of different versions (fixture test).
- [x] Raw HTML in markdown is stripped; headings get slugs; tables and lists render with block ids on cells and items.
- [x] Diff fixture: 4 changed, 1 added, 0 removed paragraphs produce exactly that summary and a redline whose deletions and insertions match the golden HTML.
- [x] Re-anchoring: same-version exact placement; moved-paragraph placement via id; reworded-paragraph placement via quote + context; a 12-character quote with zero context agreement returns `null`.
- [x] Bundle of `packages/shared`'s browser-facing exports is under 25 KB gzipped.

## Risks / unknowns

- **Hash collisions on short blocks** ("Yes.") — ordinal suffix handles same-version duplicates; cross-version reordering of identical short blocks may swap ids; acceptable because quote search backs it up.

## Notes

- `render()`'s block descriptor grew beyond the plan's literal `{ id, text, headingPath }`: it also carries `tag` and a per-block serialized `html`. `diff/` needs both to build a redline without re-parsing markdown, and `tag`/`ordered` are what let it flag a formatting-only change (heading level, list marker) instead of redlining it.
- `placeAnchor` takes a third argument, `displayedVersion`, beyond the plan's `placeAnchor(anchor, blocks)`. The spec's re-anchoring steps 1 ("same version") and 2 ("block id present") are procedurally identical — locate the block by id, verify the quote, place — and differ only in whether the displayed version equals the anchor's version, which is exactly what distinguishes confidence `"exact"` from `"block"`. There was no way to report that distinction without knowing the displayed version.
- `SIMILARITY_THRESHOLD` (0.5, a Jaccard-like ratio over `diffWordsWithSpace`'s common-vs-total character counts) is an implementation choice — the spec says only "above a threshold." Chosen empirically against the golden fixture; short-block edits (e.g. a 10-character cell gaining one word) sit right at this boundary, which is the practical version of the "Hash collisions on short blocks" risk noted above: short text has less room for similarity math to work with, not just id collisions.
- `packages/shared`'s browser-facing bundle (`src/browser.ts`: `anchor/*` + `diff/*`) measured ~11.4 KB raw / ~4.4 KB gzipped minified — well under the 25 KB budget, with room to spare. The `diff` npm package tree-shakes down to just `diffWordsWithSpace`.
- `anchor/dom.ts`'s actual DOM behavior (`anchorFromSelection`, `rangeFromAnchorPlacement`) is untested here — Bun has no DOM, so only import-safety (no top-level DOM access) is verified. `comment-mode`'s existing scope and Validation ("Selection capture... anchor via `computeAnchor`; highlights via `placeAnchor`"; "Touch long-press selection on a phone emulator produces the 'Comment' button") already covers exercising it for real, so no plan edit was needed to absorb this — it was already in scope there.

## Follow-ups

None.
