---
status: done
depends: []
specs:
  - specs/screens/version-history.md
  - specs/behaviors/versioning.md
  - specs/api/participant.md
issues: [69]
pr: 82
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

- [x] A revision of the shape that broke — a reworded sentence, a changed number, a changed table cell, an added list item, and a table that gains a column — reads correctly at 390 and 1280 (screenshots on PR #82). Verified against a throwaway data repo seeded in the worktree rather than the named sim-run document: the plan predates the rule that browser checks never touch the real data repo, and the fixtures reproduce the same edits.
- [x] Shared diff tests cover word boundaries (`<del>four</del> <ins>five</ins>`, and no `</del><ins>` anywhere) and whole-table comparison in both the shape-kept and shape-changed forms.
- [x] #69 closed by the PR.

## Risks / unknowns

- Atomic-block treatment loses inline detail inside tables; acceptable for readability. Narrowed in practice: only a table whose *shape* changed loses inline detail. A table that kept its rows and columns is still redlined cell by cell, so the common "one cell reworded" revision reads as well as prose does.

## Notes

- **The redline aligns units, not blocks.** The fix that matters is structural: `diff/units.ts` collapses a table's cells into one unit before alignment, so the LCS never tries to match a cell against a paragraph. Everything else — the summary counts, the whole-table before/after, the in-place cell redline — falls out of that. `alignBlocks` is generic over `{ id, text }` so both unit kinds go through the same alignment.
- **Table containers ride on the blocks, not beside them.** `render/block-ids.ts` attaches a shared `container` (id, text, HTML, shape) to each cell rather than returning a second list, so `diffVersions(Block[], Block[])` kept its signature and neither compare route nor the render cache changed. Commentable blocks are exactly what they were, so comment anchoring is untouched.
- **The separator rule is narrower than "space between runs".** A space is inserted only where a deletion meets an insertion *and* neither side already carries whitespace. Inserting one unconditionally would have broken suffix edits: `Friday<ins> at noon</ins>.` must stay as it is.
- **`diffWordsWithSpace` splits on punctuation too.** "1:750" → "1:700" comes out as `1:<del>750</del> <ins>700</ins>`, not a whole-token swap. Readable, but worth knowing before writing a golden assertion against a number change.
- **Tables had no CSS at all.** `.doc-body` never styled `table`/`th`/`td`, so a signatory table rendered as run-together text on the document screen as well as the compare screen. Added with `display: block` so a wide table scrolls inside the column instead of widening the page on a phone.
- The "Removed"/"Added" labels on a stacked table are emitted by the shared diff rather than the web copy module, because the spec places the label in the redline itself and the redline is rendered server-side.

## Follow-ups

- Issue [#83](https://github.com/JarvusInnovations/community-drafter/issues/83) — a whole added or removed list item loses its bullet on the compare screen, because each block is wrapped in its own `div` outside the `ul`. Pre-existing, visible in the PR screenshots.
- Issue [#84](https://github.com/JarvusInnovations/community-drafter/issues/84) — fenced code blocks never appear in a comparison at all: they are not emitted as blocks, so a changed code block is silently invisible. Making them comparable means deciding whether they are commentable, which is a change to `behaviors/inline-comments.md` § Block identity.
- None for blockquotes: the plan proposed treating them atomically, but their paragraphs already align as paragraphs and read better that way. The spec now says tables only.
- `format_only` blocks still render as a plain unredlined block; `behaviors/versioning.md` § Diff step 6 asks for "a small marginal note". Out of scope here — tracked by the existing gap, not re-filed.
