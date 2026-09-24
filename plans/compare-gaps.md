---
status: done
depends: [redline-quality, admin-dashboard]
specs:
  - specs/behaviors/versioning.md
  - specs/behaviors/inline-comments.md
  - specs/screens/version-history.md
  - specs/screens/admin-dashboard.md
  - specs/api/admin.md
  - specs/api/participant.md
issues: [84, 107]
pr: 121
---

# Plan: compare-gaps

## Scope

Two gaps in the version comparison. (1) A fenced code block that changed between two versions is silently absent from the redline and from the summary line (#84), because the render pipeline emits no block for it. (2) The admin console has no compare screen at all (#107): the versions page lists versions and shows their text, but the team cannot see what changed between two of them without switching to a participant link. Out: making code blocks commentable; any change to an existing block id or block text; the CLI's terminal rendering of a stacked table or code block.

## Implements

- `specs/behaviors/versioning.md` § Diff — a code block is a comparison unit, compared whole and stacked when changed; the summary names "code block".
- `specs/behaviors/inline-comments.md` § Block identity — code blocks are not commentable and never shift another block's id.
- `specs/screens/version-history.md` § Compare — a code block reads as a code block.
- `specs/screens/admin-dashboard.md` § Versions — `/admin/d/<slug>/versions/compare`, reached from each row and from the page header.
- `specs/api/admin.md` / `specs/api/participant.md` — the compare response's `kind` gains `"code block"`; the admin compare refuses a same-version pair like the participant one.

## Approach

1. `render/block-ids.ts` records each `pre` that is not inside a list item as a separate code unit (`c-<8 hex>` id from its own counter, raw code text, serialized HTML, and its position among the commentable blocks) on the render result, beside `blocks` and never in it. `Block[]` is byte-for-byte what it was.
2. `diff/units.ts` interleaves code units into the unit sequence by position; `diffVersions` accepts either `Block[]` (as today) or a render result carrying `code`. A changed code block renders in the stacked "Removed"/"Added" form tables use; same shows once; added/removed show whole. Summary kind `"code block"`.
3. The three compare routes and the render cache pass the render result, so code reaches the diff.
4. Admin API: the existing `GET /admin/api/documents/:slug/compare` refuses `from == to` with `invalid_request`, matching the participant route.
5. Web: extract the participant compare body (selectors, summary line, legend, hide-unchanged toggle, redline) into a shared component used by the participant, public and new admin screens. Admin route `versions/compare` with `from`/`to`/`hide_unchanged` in the URL; "Compare with previous" per row (not on v1) and a "Compare versions" header link (only with two or more versions). CSS strikes/underlines a stacked code block.

## Validation

- [x] Shared diff tests: a changed code block is one "code block changed" stacked Removed/Added; an unchanged one appears once as `same`; added/removed are counted; a code block inside a list item stays part of that item.
- [x] A render test proves every non-code block's id and text are identical for a document with and without its code blocks, including a code block whose text equals a paragraph's.
- [x] API test: `GET /admin/api/documents/:slug/compare` returns the diff for a two-version document and `invalid_request` for `from == to`.
- [x] Web test: the admin compare screen renders the summary line and redline from the admin API, and the versions table links "Compare with previous" for every version but v1.
- [x] Lint, format:check, typecheck and tests pass in `packages/shared`, `apps/api` and `apps/web`; `apps/web` builds and `check:bundle-size` passes.
- [ ] #84 and #107 closed by the PR.

## Risks / unknowns

- A code block with identical text in two places gets an ordinal suffix from its own counter; alignment by id then works as it does for paragraphs.

## Notes

- **Code rides beside the blocks, not on them.** `redline-quality` hung tables off their cells as a `container`. A code block has no commentable block to hang from, so the render result gains a `code` list. Each entry records its position among `blocks`, and `toUnits` slots it back in. `diffVersions` still accepts a bare `Block[]` and then compares the commentable blocks alone, so anything that calls it with blocks only (older tests, anchoring) behaves exactly as before.
- **Code keeps its whitespace.** Code text is taken verbatim, minus the fence's trailing newline, and is never normalized the way block text is. Indentation is meaning in code.
- **Similarity still decides whether two code blocks pair up.** A short snippet that changed almost completely falls below the threshold and shows as removed plus added rather than as one change, the same as a paragraph. The API test uses code that stays similar for that reason.
- **The compare body is one component now.** The participant and public screens were near-copies. `CompareView` holds the selectors, summary, toggle, URL state and redline, and each screen supplies only its frame classes, heading level, fetcher and back link.
- "#84 and #107 closed by the PR" is left unchecked. It can only be checked once the PR merges, and this plan's PR is not merged yet.
- `Timeline.test.tsx` "commenting: first segment active…" fails on develop too. It is unrelated to this plan.

## Follow-ups

- Issue [#122](https://github.com/JarvusInnovations/signatories/issues/122): the CLI's `versions compare` loses the removed/added markers on a stacked table or code block.
