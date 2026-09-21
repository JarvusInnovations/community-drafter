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
