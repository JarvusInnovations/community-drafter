---
status: planned
depends: [participant-sign-flow]
specs:
  - specs/screens/comment-mode.md
  - specs/behaviors/review-and-judgement.md
  - specs/behaviors/inline-comments.md
  - specs/api/participant.md
---

# Plan: comment-mode

## Scope
Everything about submissions: the draft-submission and `submit` endpoints in the API, the comment-mode screen with selection capture, the three-layer save path (browser buffer → durable per-comment save → buffer clear), the review tray with per-item state and judgement, submission, rebase across versions, and display of earlier submissions on the document screen. Out: dispositions UI for admins (→ `admin-dashboard`; the API side of dispositions is in `api-core`).

## Implements
- `specs/api/participant.md` — draft submission endpoints, `submit`.
- `specs/behaviors/review-and-judgement.md` — all.
- `specs/behaviors/inline-comments.md` — *Capture*, *Highlights* (functions from `render-and-diff`).
- `specs/screens/comment-mode.md` — all.

## Approach
1. API: `draft` GET, `draft/comments` POST/PUT/DELETE, `draft/rebase`, `submit`; each save is its own `Action: comment` commit and responds after commit with `saved_at`; `stale_edit` and `unsaved_items` per spec.
2. Client buffer: a small store keyed `doc/person/commentId` in local storage (try/catch, memory fallback); composer writes to it on every keystroke; "Add" triggers the save; ack clears the entry; failures keep it and retry with backoff.
3. Selection capture: `selectionchange` debounced + `mouseup`; floating "Comment" button; anchor via `computeAnchor`; highlights via `placeAnchor`, idempotent teardown/rebuild.
4. Tray: items with per-item state badges, general composer, judgement radio driven by signature status, submit button label by judgement, "Your earlier submissions".
5. Version mismatch bar with "Keep on v2" / "Move to v3" calling `draft/rebase`.
6. Document screen: "Your submissions" section and the draft-exists line.

## Validation
- [ ] Type a comment, kill the tab before "Add", reopen: text is restored with the "Restored from this device" state.
- [ ] "Add" while the API is unreachable shows "Not saved, retrying" and succeeds when the API returns; the data repo then has exactly one `Action: comment` commit for it.
- [ ] After ack, the local-storage entry for that comment is gone.
- [ ] Submit with `pending > 0` is refused with `unsaved_items`; with all saved it flips the record to `submitted` with the judgement and, for `sign_conditional`, sets `signature.conditional`.
- [ ] `sign_conditional` is disabled in the UI and rejected by the API when the draft has no comments.
- [ ] Publishing a new version while a draft exists shows the mismatch bar; "Move to v3" re-anchors and reports unplaced comments with their quotes still visible.
- [ ] Touch long-press selection on a phone emulator produces the "Comment" button.
- [ ] Nobody else's comments appear in any participant response (test with two participants).

## Risks / unknowns
- **Selection inside injected HTML** — React re-renders must not tear down the document body node between selection and capture; keep the body in a stable ref.

## Notes
(closeout)

## Follow-ups
(closeout)
