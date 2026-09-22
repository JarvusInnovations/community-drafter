# Behavior: Versioning, Changelog and Diffs

## Rule

A document's text exists only as **published versions**, numbered v1, v2, v3 … contiguously, each with a timestamp and a one-line **summary** of what changed. Versions *are* the git commits in which the document record's body changed: the commit message carries the summary, the commit is the version, and nothing about a version is stored anywhere else. Participants always see the latest version by default, clearly labeled, and can read any earlier version and a readable comparison between any two.

## Applies To

`screens/document.md`, `screens/version-history.md`, `screens/comment-mode.md` (comments are made against a version), notifications (revision alerts), the admin publish action, `behaviors/inline-comments.md`.

## Details

**Publishing.** An admin (human or agent) publishes a version by supplying the full new markdown text, a summary (1–200 characters, imperative or descriptive, e.g. "Tightened term 2; added the collections-care ask"), optional team notes, an optional `final` flag, and optional dispositions for earlier comments (see `review-and-judgement.md`). Publishing is one transaction and therefore one commit: subject `publish: <slug> v<n>`, trailers `Summary:`, `Final:` (when set), `Notes:` (when given), `Disposed:` (when dispositions are attached), `Document:`, `Actor:`; the commit writes the document body, any settings it changes, and the disposition fields on the affected submissions together. Notifications are queued from that commit. A publish whose text is byte-identical to the current version is refused (`no_change`) so a version always changes something. Version numbers are never reused or skipped because the history is append-only.

**Any body change is a version.** If a teammate edits the document's body with `gitsheets-axi` or by hand and pushes, that commit is a version too and shows up with its subject as the summary; a commit that only touches frontmatter settings is not. This is by design (the record is the source of truth); the admin CLI is simply the way to attach a good summary, dispositions and notifications. The service tolerates a commit with a poor summary by showing the subject; it never hides a version. The history is therefore derived from **every commit that changed the record's body**, not only from the commits this service wrote: a commit carrying none of the service's trailers still counts, with its subject as the summary and its git author as the publisher, and it shows up in the document's activity as an event with no action.

**The label.** Wherever a version's text is shown, its label reads: "**Version 3** · published Sep 20, 2026 at 9:14 AM EDT · *Tightened term 2; added the collections-care ask*". If it is not the latest, a notice says so and links to the latest. If `final` is set, the label adds "final text". Numbers, dates and the summary are derived from the commit; nothing about git appears.

**Unchanged first version.** v1's summary is required too; convention is "Initial draft" or a description of provenance.

**History.** The history view lists versions newest first: number, date, summary, who published (team label, not an email), how many comments it answered (count of dispositions), and a "compare with previous" action. Any version can be opened read-only with its own label and the comments that were made against it.

**Rendering.** A version's markdown is rendered to sanitized HTML server-side, once per version, and every surface that shows the text — document screen, older-version view, comment mode, compare, the deliverable PDF — shows the output of that one pipeline. Raw HTML in the markdown is stripped, never passed through. GitHub-flavoured markdown is supported: tables, task lists, strikethrough, autolinks and real footnotes (`[^1]`).

Three rendering rules are settled here because they change what a reader sees without changing what a comment is attached to.

- **Block identity is invariant.** Whatever rendering options are in force, the commentable blocks — their ids, their normalized text, and the order they come in — are identical. Options may add material around the text; they may never renumber, retext or reorder a block, and nothing an option adds is itself a commentable block. A comment written under one set of options must still land in the same place under another.
- **A horizontal rule is a section break.** `---` between blocks renders as a quiet break in the reader's flow — a short centered hairline in the border tone, with generous space above and below — not as a full-width black line jammed against the text, and not as a page-width divider that competes with a heading. It carries no text, is not commentable, and looks the same on screen and on paper.
- **An author may mark a block with one of four classes.** See *Block classes* below.

**Citations.** Inline links in the markdown are the source of truth for citations; nothing else is a citation and there is no separate bibliography to keep in step. How those links are *presented* is a rendering option, `citations`, with three modes:

- **`links`** — links render as links and nothing is appended. The default everywhere a reader can click, and the only mode the comparison view and comment mode ever use.
- **`footnotes`** — each citation link's text renders plain (no longer a link), followed by a superscript number, and a **Sources** section is appended at the end of the document listing each cited URL once. For reading on paper.
- **`hybrid`** — the link stays clickable *and* gets the superscript number, and the Sources section is appended. The default for the deliverable PDF: a reader on a computer clicks, a reader holding the printed page uses the numbers.

The rules that govern all three:

- **What counts as a citation.** A link whose target is an absolute `http`/`https` URL. A `mailto:` link, a link to a place inside the document, and anything inside a real GFM footnote are all left exactly as they are, in every mode.
- **A visible URL is never a citation.** When a link's own text is itself a URL — an autolink, or a link the author wrote with the address as its label — the address is already on the page, so a number would add nothing. Such a link keeps its link form in every mode, takes no number, and does not appear in Sources.
- **Numbering** is by first appearance, from 1, in document order.
- **A URL cited twice keeps one number and one Sources entry.** Two citations are the same source when their URLs are equal after any text fragment (`#:~:text=…`) is removed: a text fragment names a phrase to highlight, not a different document, and an author who quotes three passages of one article is citing one source. The link's own target keeps the fragment, so clicking still jumps to the passage; the Sources entry shows the address without it.
- **Sources is not part of the statement.** It is appended after the text, headed "Sources", numbered to match the superscripts, and contributes no commentable blocks — a reader cannot comment on it and a diff never mentions it.
- **On a screen the numbers work.** Each superscript links to its Sources entry and each entry links back to the place it was cited, so `footnotes` and `hybrid` are usable on a screen and not only in print.
- **Real GFM footnotes are untouched.** A document that uses `[^1]` gets the same footnote section it gets today, in every mode, separate from Sources.

**Block classes.** An author may mark a block with one of a small, fixed set of classes. Two syntaxes, both standard:

- A trailing `{.class}` on a paragraph or a heading marks that one block: `The museum closes Saturday. {.lede}`
- A fenced container marks a run of blocks: a line reading `::: callout`, the blocks, then a line reading `:::`. `:::callout` without the space means the same thing. **Each fence line stands alone, with a blank line between it and the content.** The store normalizes a body's markdown on every write (`architecture.md` § Storage), and one of the things that normalization does is join the lines of a paragraph — a fence written hard against the line below it is swallowed into that paragraph and stops being a fence. A blank line on each side is what survives the round trip, so it is the syntax, not a style preference.

The whitelist is `lede` (a larger, looser opening paragraph), `callout` (a soft bordered box), `small` and `center`. **Anything not on the list is discarded** — the marker never appears as literal text in the output, and the class never reaches the HTML. The list is deliberately short: this is typographic emphasis an author can reach for, not a styling language, and a new entry is a spec change.

A container is a wrapper and nothing more. The blocks inside it stay the commentable blocks, with the ids and the text they would have had without it, so adding or removing a container never orphans a comment.

**Diff.** A comparison between two versions is computed server-side as a block-aligned redline:

1. Split each version's rendered text into the units a reader would name: paragraphs, headings, list items, and whole tables. A table is one unit, not a loose run of cells; its cells are only ever compared against the cells of the table it aligns with.
2. Align units by id, then by best textual match (normalized-text similarity above a threshold) for units whose text changed, using a longest-common-subsequence alignment so moved units are shown as removed and added rather than mismatched.
3. Within an aligned pair whose text differs, compute a word-level diff and render deletions as struck text and insertions as underlined/highlighted text inside the unit. Words never run together: where a deletion and the insertion replacing it meet, a space separates them, so "four" becoming "five" reads as two words and not as "fourfive".
4. A changed table keeps its shape wherever it can. If both versions have the same rows and the same cells in each row, the table is shown once — the new table, with each changed cell redlined in place. If the shape changed, the table is shown twice and stacked: the whole old table struck through and labelled as removed, above the whole new table underlined and labelled as added. Detail inside a restructured table is not redlined.
5. Whole added or removed units are rendered whole with the same styling.
6. Formatting-only changes (heading level, list marker) are shown as a small marginal note, not as a redline of the whole unit.

The comparison view carries a summary line and a toggle to hide unchanged units. The summary counts changes the way a reader would: one reworded paragraph is one change, and one edited table is one change however many cells it touched. It names the kinds involved rather than reporting bare totals — "2 paragraphs changed, 1 table changed", "1 heading changed, 2 list items added" — listing changed kinds first, then added, then removed, omitting any kind with nothing to report, and reading "No changes" when the two versions render identically. Default comparison is latest vs previous; any pair may be selected.

**What participants never see.** Commit hashes, branch names, the data repository, the word "commit", raw markdown (except when an admin exports it).

**Admin sees more.** The admin dashboard shows, per version, the publisher identity, notes, the disposition list and a link to the raw markdown.

## Principles

**Inherited**
- [Versions are for normies](../principles.md#versions-are-for-normies): the summary line is mandatory precisely so there is always a human sentence to show; git stays invisible.
- [Comments never orphan silently](../principles.md#comments-never-orphan-silently): every comment stores the version it was written against, and the history view can show that version with its comments.

**Local**
- **One publish, one commit.** The commit is the version: text, summary, final flag and dispositions ride together or not at all. Implementers must not write the text in one commit and its metadata in another, and must not keep a versions table that could disagree with the history.
