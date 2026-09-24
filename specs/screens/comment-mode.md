# Screen: Comment Mode

The pull-request-review experience for one document: read, mark up passages, write a general note, then submit everything with a judgement.

## Route

`/i/<token>/comment` (against the current version) and `/i/<token>/comment?v=<n>` (against an earlier version, allowed while a draft against that version exists).

## Data Requirements

Everything the document screen needs, plus: the participant's draft (or none), the rendered version with block ids, the participant's earlier submitted comments on this document with dispositions, and the phase (commenting required to save or submit).

## Display Rules

Layout: the document occupies the main column; a **review tray** is a side panel on wide screens and a bottom sheet on phones. The status card from the document screen is not shown; a slim bar at the top shows the phase and deadline, the version label, the person's signature status in one line, and "Back to document".

**Document column**

- Rendered current (or selected) version with highlights for the participant's own pending comments (draft) and their own submitted comments (styled distinctly, read-only). Other participants' comments are never shown.
- Selecting text within a commentable block shows a floating "Comment" button near the selection. Choosing it opens a small composer anchored to the selection with a text area and "Add" / "Cancel". Adding creates an inline comment in the draft and highlights the passage.
- Clicking a highlight focuses that comment in the tray.

**Review tray**

- Header: "Your submission on v3" and a summary line "3 comments saved, not yet sent". Each item carries its own state: "Saved", "Saving…", "Not saved, retrying", or "Restored from this device" (recovered from the browser buffer and not yet saved), per `behaviors/review-and-judgement.md`. The composer warns before navigation only when something is neither saved nor buffered.
- **Inline comments** list in document order: each shows the quoted passage (truncated to two lines, expandable), the heading it sits under, the body (editable in place), and delete. Comments whose anchor could not be placed (draft written on an older version) show the badge "written on v2 · passage changed" and still render.
- **General comment**: a labeled text area, "Anything about the document as a whole".
- **Judgement**: radio group whose options depend on signature status (table in `behaviors/review-and-judgement.md`), with one-line explanations. Conditional options are disabled with a hint when there are no comments.
- **Submit** button labeled by the judgement ("Sign and send comments", "Send comments", "Send and decline"). Disabled with reason when the phase is not commenting, when no judgement is selected, when nothing has changed and the judgement is `comment`, or when the judgement signs in official capacity and the authorization attestation is unchecked. A submission the server refuses is never swallowed: the refusal's message is shown as an alert next to the submit button and announced, so pressing the button always produces either a confirmation or a reason.
- Beneath the tray: "Your earlier submissions" (collapsed), each shown whole (version, date, judgement, its comments with disposition badges).

**Phase not commenting**: the tray shows the draft read-only with "Comments closed Sep 23 at 5:00 PM EDT. Your unsent comments are kept here." and the sign/revoke actions still available if the phase is signing.

**Version mismatch**: if the draft's version is older than current, a bar offers "Keep commenting on v2" or "Move my comments to v3" (re-anchoring per `behaviors/inline-comments.md`); the choice is recorded on the draft.

## Design

Follows `screens/document.md` § Design (same tokens, top bar, cards, buttons, links). Specifics for this screen:

- **Frame**: the sticky top bar carries the phase pill; beneath it a slim second bar (card-colored, bordered) holds the version chip, the one-line signature status, and "Back to document" as a link on the right.
- **Document column**: the rendered text in a card, same measure as the document screen. The participant's own pending comments are highlighted with the pale blue tint and a blue underline; submitted ones with the neutral muted tint and a dotted underline. The floating "Comment" button is the primary style, small, with a soft shadow, anchored just above the selection.
- **Review tray**: a card, sticky on wide screens (360 px, right column), a bottom sheet on phones with a drag handle and a header that stays visible ("Your submission on v3 · 3 saved, not yet sent"); the sheet starts collapsed to that header so the document stays readable, and opens on tap, when a comment is added, or when a highlight is tapped. Items are bordered rows: heading path in small muted caps, the quote in italics, the editable body, and a state badge (Saved in green soft, Saving in muted, Not saved in amber soft, Restored in blue soft). The judgement options are bordered radio rows with the label bold and the explanation muted; the selected row takes the blue tint and border. The submit button is the primary style, full width, disabled state muted with the reason beneath.
- **Composer** (inline comment): a card with a textarea, "Add" primary small and "Cancel" quiet.
- **Version mismatch bar** and the phase-closed notice use the amber note style.

| Action | Effect |
| --- | --- |
| Select text → Comment → Add | adds an inline comment to the draft; autosaves |
| Edit / delete inline comment; edit general comment | updates the draft; autosaves |
| Choose judgement | stored provisionally on the draft |
| Submit | POST review; on success shows a confirmation panel ("Sent. You signed as… / You'll hear back when a new version is published.") with "Back to document"; the tray resets to empty for a new draft. On failure the tray stays as it was and shows the server's message as an alert beneath the button |
| Move my comments to v3 | re-anchors draft comments; updates draft version |
| Back to document | returns to `/i/<token>` |

## Navigation

Arrives from the document screen's "I have comments first" / "Add comments" / "Continue", or a notification deep link. Leaves to the document screen or history (via the version label).

## Principles

**Inherited**

- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): per-item save state is always visible; the queue of saved-not-sent comments is explicit; nobody else's comments appear.
- [Comments never orphan silently](../principles.md#comments-never-orphan-silently): unplaceable comments still render with their quotes.
- [Sign first, everything else after](../principles.md#sign-first-everything-else-after): the participant is never forced into this screen; it is one link away from the card and one link back.
- [Keyboard first, announce every state change](../principles.md#keyboard-first-announce-every-state-change): the composer is a labelled dialog Escape closes, the tray submits on Enter, and sending moves focus to the confirmation heading.

**Local**

- **Submitting is a single decision.** The judgement and the comments go together; there is no separate "post comment" button that publishes one comment at a time. This keeps the team's view a set of positions, not a chat.