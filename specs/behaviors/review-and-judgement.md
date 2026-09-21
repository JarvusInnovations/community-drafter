# Behavior: Review, Judgement and Dispositions

## Rule

Commenting works like a pull-request review for one document. A participant builds one **draft submission** at a time: a set of inline and general comments against one version. Each comment is saved to the server the moment it is finished, durably, and the participant sees exactly what is saved and not yet sent. The team can read a draft submission, always whole and always labeled *unsubmitted*. **Submitting** with a **judgement** states where the participant stands (their *position*) and turns the draft into a submitted submission. The team answers in bulk by publishing a new version that sets a **disposition** on each comment, and reads every comment in the context of its submission.

## Applies To

`screens/comment-mode.md`, `screens/document.md` (the sign card's decline path), the admin feedback export and publish actions, `notifications.md` (disposition alerts).

## The draft submission

- At most one draft per person per document. The first saved comment creates it, against the version being viewed. If a new version is published while a draft exists, the draft keeps its `version`; the participant is told "you're commenting on v2; v3 is now current" with a choice to keep commenting on v2 (comments carry their version) or switch (the draft's inline anchors are re-anchored per `inline-comments.md`, unresolvable ones kept with their quotes).
- **Three layers, no gaps.** (1) While typing, the composer's text is buffered in the browser (local storage when available, else memory) keyed by document, person and comment id, so a reload or crash restores it. (2) When the participant finishes a comment ("Add", or leaves the composer with text in it) or pauses 3 seconds in the general comment's composer, the client saves that item to the server. The server acknowledges **only after the write is durable in the record** (committed), never from memory. (3) On acknowledgement the client clears that item's browser buffer. If the save fails, the item stays buffered, the tray shows "Not saved, retrying" on that item, and retries continue with backoff; nothing is ever discarded on failure.
- **Conflict rule:** a server copy never overwrites a newer local edit; the client compares `saved_at` and keeps the newer text, and the tray says so when it happens.
- A draft submission is readable by its author and by the team. Admin views and the feedback export show it whole, in its own clearly labeled group, never mixed with submitted ones; it carries no judgement. Notifications never quote it.
- Deleting a comment, inline or general, deletes its record (history keeps it).
- Unsubmitted comments survive the comment period closing (readable, not submittable) and are retained; nothing is ever cleaned up out of the record.

## Submission

Submitting requires a judgement. Available judgements depend on whether the person is a current signatory:

| Not currently signed | Currently signed |
| --- | --- |
| **Sign** — add my name | **Keep my signature** |
| **Sign conditionally** — add my name; I want to see my comments addressed | **Make my signature conditional** on my comments |
| **Comment without signing** | **Remove my signature** (confirmation required) |
| **Decline** — I won't be signing | |

Constraints:

- `sign_conditional` / "make conditional" requires at least one comment in the submission.
- `decline` may be submitted with no comments at all, from comment mode or from the sign card's "I'd rather not sign" link; an optional reason is stored on the participation (`declined_reason`) and in the commit's `Reason` trailer, not shown to other participants. Decline revokes any current signature after confirmation and stops reminders. A later sign replaces the `decline` position.
- `comment` never changes signature state.
- Submission is one commit (`Action: submit`, trailers `Submission`, `Judgement`, `Version`): the draft's `state` becomes `submitted` with its `judgement`, and the participation's `signature` changes if the judgement calls for it. The confirmation is triggered from it. A person may submit as many times as they like over a document's life; each is its own record and its own commit.
- After submission the participant sees their submitted comments grouped by submission ("v2, submitted Sep 19, signed conditionally") under the document, and may keep adding new ones.
- Submission with comments is refused outside the commenting phase with the deadline that closed it; `decline` with no comments and signature-only changes follow the sign/revoke rules in `document-lifecycle.md`.

## Dispositions

When the team publishes a version, they may attach a disposition to any pending comment on the document (pending = no disposition yet):

| Outcome | Meaning shown to the author |
| --- | --- |
| `accepted` | "Incorporated in v3" |
| `partial` | "Partly incorporated in v3" + note |
| `declined` | "Not incorporated" + note (note required) |
| `noted` | "Read and noted; no text change" |

Where there is no room for that sentence — an email line, a badge on the author's own submission — the outcome is labeled "Accepted", "Partly addressed", "Declined" or "Noted". The raw wire value is never shown to an author.

Rules:

- A comment receives at most one disposition. Once dispositioned it is closed; the author may raise the point again in a new comment.
- Dispositions are fields on the comment's entry in its submission record, written in the publish commit itself (`Disposed` trailer lists `<submission>:<comment>` refs), so the version that answered is the commit that set them.
- Authors are notified per their `my_comments_addressed` preference, one message per version listing each of their comments and its outcome.
- Comments with no disposition after the document closes are marked `unanswered` in the admin view; nothing is sent to authors about them automatically.

## Feedback export (for the LLM round)

The admin export for a document produces, in one file: the current version's text; every **submission** with at least one comment not yet dispositioned, whole (author display name, capacity/org, version, judgement, reason, and each comment's anchor (quote, heading path, block), body and any existing disposition), submitted ones first and draft ones in a separate labeled section; a tally of judgements per version; and the current signatory count. Comments are never exported detached from their submission. Every section of the export states its own emptiness — a heading with nothing under it reads as a truncated file, not as "none yet". The export is the input to the team's or agent's revision work; the publish action is the output path. Dispositions may target unsubmitted comments too; the author sees the disposition if they later submit or on their own page.

## Principles

**Inherited**
- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): the three-layer save path and the unsubmitted label.
- [The clock is real](../principles.md#the-clock-is-real): the server refuses late submissions.

**Local**
- **A judgement is mandatory, a comment is optional.** Every submission states where the person stands. This is what turns a pile of comments into a count the team can act on, and it is why "decline with nothing to say" is a first-class outcome rather than silence.
- **The submission is the unit of meaning.** People split one line of thought across inline and general comments however it falls, and the pieces only read correctly together, by one author, against one version, under one judgement. No view, export, notification or API response shows a comment without the rest of its submission. Dispositions are per comment, but they are set and displayed within the submission.
- **Conditional is a private flag.** A conditional signature displays publicly exactly like any other. The flag is for the team's outreach when the final version lands, and for the signer's own dashboard line ("You signed conditionally on v2; 2 of your 3 comments were incorporated in v3").
