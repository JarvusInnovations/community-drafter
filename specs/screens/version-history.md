# Screen: Version History and Comparison

## Route

`/i/<token>/history` (participant) and `/d/<slug>/history` (public, when `public_access ≠ none`). Comparison: `…/history/compare?from=<a>&to=<b>`; defaults to `to = current`, `from = to − 1`.

## Data Requirements

All versions derived from the document record's body-changing commits (number, date, summary, publisher label, disposition count), the current version number, and for comparison the server-computed block-aligned diff between two versions (`behaviors/versioning.md`).

## Display Rules

**List**
- Newest first. Each row: "Version 3 · Sep 20, 2026, 9:14 AM EDT", the summary in emphasis, "answered 12 comments" when dispositions exist, and two actions: "Read" and "Compare with previous" (absent on v1).
- The current version row is marked "current". No row is ever labeled final (`behaviors/versioning.md` § No version is "final").
- A short explainer at top: "Each version is the full text as published on that date. The one-line note says what changed."

**Read a version**: the document screen layout in read-only form with the "you're reading an older version" banner (`screens/document.md`). Participants see their own comments made against that version.

**Compare**
- Header: "What changed from version 2 to version 3", the summary of the `to` version, the change summary line ("2 paragraphs changed, 1 table changed"; "No changes" when the two versions render identically), and two selectors to change `from` and `to`. When `from` and `to` are the same version (including a document with a single version), the page says there is nothing to compare yet instead of requesting a diff.
- Body: the redline per `behaviors/versioning.md`: deletions struck, insertions highlighted; whole added/removed blocks marked in the margin. A deletion and the insertion replacing it are always separated, so a reworded phrase still reads as words. A table reads as a table: cells redlined in place when the table kept its shape, otherwise the old table above the new one, each labelled. A changed code block is always shown that second way, old above new, each labelled; an unchanged one is shown once. A toggle "Hide unchanged paragraphs" defaults on when the document exceeds 30 blocks, off otherwise.
- A legend explains the two styles in one line. Color is never the only signal (strike-through and underline are used in addition to color, and a stacked before/after table carries word labels).
- Every block keeps the shape it has in the document, whatever its status: a list item shows its marker and lines up with the list items above and below it, added, removed or unchanged alike. The margin marking for an added or removed block is drawn in a gutter every block reserves, so marking a block never shifts it relative to its neighbours.

## Actions

Read a version; compare; change the compared pair (URL updates so the comparison is shareable within the same link); back to document.

## Navigation

From the document screen's version label ("See what changed", "All versions"), from revision notifications ("see what changed" links land on the comparison), from comment mode's version label.

## Principles

**Inherited**
- [Versions are for normies](../principles.md#versions-are-for-normies): numbers, dates and summaries only; the comparison reads like tracked changes, not like a patch.

**Local**
- **Count and show changes the way a reader would name them.** A change is a thing on the page that looks different — a paragraph, a heading, a list item, a table, a code block — never an internal unit of the diff algorithm. Where the algorithm's units and the reader's units disagree, both the summary line and the redline follow the reader's: a table edited in five cells is one changed table, and a redline that would make a reader re-read a sentence to find the words is wrong even when it is technically minimal.
