# Behavior: Versioning, Changelog and Diffs

## Rule

A document's text exists only as **published versions**, numbered v1, v2, v3 … contiguously, each with a timestamp and a one-line **summary** of what changed. Versions *are* the git commits in which the document record's body changed: the commit message carries the summary, the commit is the version, and nothing about a version is stored anywhere else. Participants always see the latest version by default, clearly labeled, and can read any earlier version and a readable comparison between any two.

## Applies To

`screens/document.md`, `screens/version-history.md`, `screens/comment-mode.md` (comments are made against a version), notifications (revision alerts), the admin publish action, `behaviors/inline-comments.md`.

## Details

**Publishing.** An admin (human or agent) publishes a version by supplying the full new markdown text, a summary (1–200 characters, imperative or descriptive, e.g. "Tightened term 2; added the collections-care ask"), optional team notes, an optional `final` flag, and optional dispositions for earlier comments (see `review-and-judgement.md`). Publishing is one transaction and therefore one commit: subject `publish: <slug> v<n>`, trailers `Summary:`, `Final:` (when set), `Notes:` (when given), `Disposed:` (when dispositions are attached), `Document:`, `Actor:`; the commit writes the document body, any settings it changes, and the disposition fields on the affected submissions together. Notifications are queued from that commit. A publish whose text is byte-identical to the current version is refused (`no_change`) so a version always changes something. Version numbers are never reused or skipped because the history is append-only.

**Any body change is a version.** If a teammate edits the document's body with `gitsheets-axi` or by hand and pushes, that commit is a version too and shows up with its subject as the summary; a commit that only touches frontmatter settings is not. This is by design (the record is the source of truth); the admin CLI is simply the way to attach a good summary, dispositions and notifications. The service tolerates a commit with a poor summary by showing the subject; it never hides a version.

**The label.** Wherever a version's text is shown, its label reads: "**Version 3** · published Sep 20, 2026 at 9:14 AM EDT · *Tightened term 2; added the collections-care ask*". If it is not the latest, a notice says so and links to the latest. If `final` is set, the label adds "final text". Numbers, dates and the summary are derived from the commit; nothing about git appears.

**Unchanged first version.** v1's summary is required too; convention is "Initial draft" or a description of provenance.

**History.** The history view lists versions newest first: number, date, summary, who published (team label, not an email), how many comments it answered (count of dispositions), and a "compare with previous" action. Any version can be opened read-only with its own label and the comments that were made against it.

**Diff.** A comparison between two versions is computed server-side as a block-aligned redline:

1. Split each version's rendered text into blocks (the same blocks that carry `data-block` ids).
2. Align blocks by id, then by best textual match (normalized-text similarity above a threshold) for blocks whose text changed, using a longest-common-subsequence alignment so moved blocks are shown as removed and added rather than mismatched.
3. Within an aligned pair whose text differs, compute a word-level diff and render deletions as struck text and insertions as underlined/highlighted text inside the block.
4. Whole added or removed blocks are rendered whole with the same styling.
5. Formatting-only changes (heading level, list marker) are shown as a small marginal note, not as a redline of the whole block.

The comparison view carries a summary line ("4 paragraphs changed, 1 added, 0 removed") and a toggle to hide unchanged blocks. Default comparison is latest vs previous; any pair may be selected.

**What participants never see.** Commit hashes, branch names, the data repository, the word "commit", raw markdown (except when an admin exports it).

**Admin sees more.** The admin dashboard shows, per version, the publisher identity, notes, the disposition list and a link to the raw markdown.

## Principles

**Inherited**
- [Versions are for normies](../principles.md#versions-are-for-normies): the summary line is mandatory precisely so there is always a human sentence to show; git stays invisible.
- [Comments never orphan silently](../principles.md#comments-never-orphan-silently): every comment stores the version it was written against, and the history view can show that version with its comments.

**Local**
- **One publish, one commit.** The commit is the version: text, summary, final flag and dispositions ride together or not at all. Implementers must not write the text in one commit and its metadata in another, and must not keep a versions table that could disagree with the history.
