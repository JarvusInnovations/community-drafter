---
status: planned
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
- [ ] Untouched paragraphs keep identical `data-block` ids across two renders of different versions (fixture test).
- [ ] Raw HTML in markdown is stripped; headings get slugs; tables and lists render with block ids on cells and items.
- [ ] Diff fixture: 4 changed, 1 added, 0 removed paragraphs produce exactly that summary and a redline whose deletions and insertions match the golden HTML.
- [ ] Re-anchoring: same-version exact placement; moved-paragraph placement via id; reworded-paragraph placement via quote + context; a 12-character quote with zero context agreement returns `null`.
- [ ] Bundle of `packages/shared`'s browser-facing exports is under 25 KB gzipped.

## Risks / unknowns
- **Hash collisions on short blocks** ("Yes.") — ordinal suffix handles same-version duplicates; cross-version reordering of identical short blocks may swap ids; acceptable because quote search backs it up.

## Notes
(closeout)

## Follow-ups
(closeout)
