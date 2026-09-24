---
status: in-progress
depends: [redline-quality, admin-dashboard]
specs:
  - specs/behaviors/versioning.md
  - specs/behaviors/inline-comments.md
  - specs/screens/version-history.md
  - specs/screens/admin-dashboard.md
  - specs/api/admin.md
  - specs/api/participant.md
issues: [84, 107]
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

- [ ] Shared diff tests: a changed code block is one "code block changed" stacked Removed/Added; an unchanged one appears once as `same`; added/removed are counted; a code block inside a list item stays part of that item.
- [ ] A render test proves every non-code block's id and text are identical for a document with and without its code blocks, including a code block whose text equals a paragraph's.
- [ ] API test: `GET /admin/api/documents/:slug/compare` returns the diff for a two-version document and `invalid_request` for `from == to`.
- [ ] Web test: the admin compare screen renders the summary line and redline from the admin API, and the versions table links "Compare with previous" for every version but v1.
- [ ] Lint, format:check, typecheck and tests pass in `packages/shared`, `apps/api` and `apps/web`; `apps/web` builds and `check:bundle-size` passes.
- [ ] #84 and #107 closed by the PR.

## Risks / unknowns

- A code block with identical text in two places gets an ordinal suffix from its own counter; alignment by id then works as it does for paragraphs.

## Notes

## Follow-ups
