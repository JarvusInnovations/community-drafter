---
status: planned
depends: []
specs:
  - specs/screens/version-history.md
---

# Plan: redline-quality

## Scope

Make the compare view readable for real revisions (#69): a reworded sentence keeps word boundaries ("four" → "five" reads as two words, not "fourfive"), a changed table is shown as a before/after pair rather than an interleaved word soup, and the summary line counts what a reader would call changes. Out: character-level diffs, side-by-side layout.

## Implements

- `specs/screens/version-history.md` § Compare — separators between removed and inserted runs; tables and code blocks compared as whole blocks (before/after) when their structure changed; summary counts paragraphs, list items, and blocks.

## Approach

1. In `packages/shared/src/diff`, tokenize on words while preserving whitespace tokens so joins keep spaces; emit `<del>` and `<ins>` with a space between adjacent runs.
2. Treat `table`, `pre` and `blockquote` blocks as atomic: if the block changed at all, render the old block struck as a whole and the new block underlined as a whole, stacked.
3. Summary: count changed/added/removed blocks by block type and phrase it ("2 paragraphs changed, 1 table changed").
4. Fixture tests with the nurses' v2→v3 markdown and the museum statement's v1→v2.

## Validation

- [ ] The v2→v3 compare of `casn-sb412-stock-medications` reads correctly at 390 and 1280 (screenshots).
- [ ] Shared diff tests cover word boundaries and atomic blocks.
- [ ] #69 closed by the PR.

## Risks / unknowns

- Atomic-block treatment loses inline detail inside tables; acceptable for readability.

## Notes

(closeout)

## Follow-ups

(closeout)
