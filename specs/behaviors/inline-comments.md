# Behavior: Inline Comment Anchoring

## Rule

An inline comment is attached to a passage of a specific version by a compound **anchor**: the version number, the stable id of the block the passage is in, the exact selected text, and short context windows either side. The anchor is enough to re-find the passage in the same version deterministically and in later versions heuristically, and always enough to *display* the comment meaningfully even when the passage is gone.

## Applies To

`screens/comment-mode.md` (capture and display), `screens/version-history.md` (comments shown on earlier versions), the admin feedback export, dispositions.

## Anchor shape

```
anchor = {
  version:        3,                     // version the comment was written against
  commit:         "a1b2c3d",              // that version's commit, for robustness if history is ever re-indexed
  block:          "b-7f3a9c2e",           // data-block id in that version's render
  heading_path:   ["3. How a statement becomes the coalition's", "Consent window"],
  quote:          "Silence is consent, and we say so on the post.",
  prefix:         "…objection pauses the statement until the core resolves it. ",
  suffix:         "",                     // up to 40 chars each; empty at block edges
  start:          212,                    // character offset of quote within the block's text
}
```

`quote` is at least 3 and at most 1,000 characters; a selection crossing block boundaries is captured as an anchor on the **first** block with the quote truncated at that block's end and a flag `spans_blocks = true` (the comment sidebar shows the full original selection text).

## Block identity

Every commentable block in a rendered version carries `data-block="b-<8 hex>"` where the hex is the leading bytes of a hash of the block's **normalized text** (Unicode NFC, whitespace collapsed, case preserved, markdown syntax and inline formatting removed). If two blocks in the same version normalize identically, the second and later get an ordinal suffix (`b-7f3a9c2e-2`). Commentable blocks: paragraphs, headings, list items, blockquote paragraphs, table cells. Container elements (lists, tables, blockquotes) are not themselves commentable. Nor are code blocks: they carry no `data-block`, and adding, removing or editing one never changes another block's id or text. The comparison view still compares them, as units of their own (`versioning.md` § Diff).

The consequence, which is the point: a block whose text does not change keeps its id across versions, so comments on untouched passages re-anchor exactly with no text search.

## Capture

In comment mode, when the participant selects text inside the document and chooses "Comment", the client computes the anchor from the live DOM: nearest ancestor with `data-block`, the block's text via a text-node walk, the offset and quote from the selection, prefix/suffix from the surrounding text, `heading_path` from preceding headings by level. Selections shorter than 3 characters or wholly outside commentable blocks show no "Comment" affordance. Selection capture must work with mouse and with touch long-press (listen to selection changes, debounced, not only mouse-up).

## Re-anchoring on display

Given a comment and the version currently displayed:

1. **Same version** (`anchor.version == displayed`): locate the block by id; place the highlight at `start` for `quote.length`; if the text at that offset does not equal `quote` (should not happen), fall back to step 3 within the block.
2. **Block id present in displayed version**: the block's text is unchanged; place as in step 1.
3. **Quote search**: find all occurrences of `quote` in the displayed version's block texts; score each by whether `prefix` and `suffix` match the surrounding text (2 points each) and whether the heading path matches (1 point); choose the best; ties go to the earliest. If found, highlight it and mark the comment "written on v2, text unchanged here".
4. **Not found**: no highlight. The comment stays in the sidebar under the heading it was written beneath (by `heading_path`, or at the end if no heading survives), rendered with its quoted original text and the badge "written on v2 · this passage has changed", with a link to open v2 with the comment highlighted.

Re-anchoring is idempotent: displaying a version tears down all highlights and rebuilds them, so live updates never stack marks.

## Highlights

An anchored passage is wrapped in a highlight element carrying the comment id(s). Overlapping anchors from different comments are allowed; the highlight shows a count. Clicking a highlight focuses the comment in the sidebar; focusing a comment in the sidebar scrolls to and pulses its highlight. Highlights are visible in comment mode and in the admin view; in the default read/sign view the document renders without highlights.

## What the record keeps

The anchor is stored verbatim on the comment's entry in its submission record. Re-anchoring results are never written back; they are computed per render. The original quote is therefore always available to a human reading the record without the app.

## Principles

**Inherited**
- [Comments never orphan silently](../principles.md#comments-never-orphan-silently): steps 3 and 4 above are the whole reason the anchor carries version, quote and heading path rather than only an offset.
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): `quote` and `heading_path` make a comment intelligible in a TOML file.

**Local**
- **Prefer a wrong-looking gap to a wrong-looking match.** When the score in step 3 is zero (quote found, no context or heading agreement) and the quote is shorter than 20 characters, treat it as not found. A comment displayed against the wrong sentence is worse than one shown in the sidebar with its original quote.
