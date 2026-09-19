---
status: done
pr: 17
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
7. Publish a `submit` bus event (`apps/api/src/events/bus.ts`'s `DrafterEvent`) from the `submit` endpoint, alongside its existing trailers — mirror `decline`'s event, which `notifications`'s dispatcher already listens for to send `review-receipt-<ts>` (`specs/behaviors/notifications.md`: "a review submitted" → the author). Reuse that same listener rather than adding a second one; today it only fires for `decline` because that's the only submitted-submission path that exists yet (deferred from `notifications`, PR #15). While here, revisit `apps/api/src/notifications/triggers.ts`'s `finalPublishedCommenterRecipients`, which reads "commenter" as "has a submitted submission" (correct today only because `decline` is the sole example) — confirm it still matches once `comment`/`sign`/`sign_conditional` submissions exist, or narrow it if a decliner shouldn't count as a "commenter" for `final-published`.

## Validation

- [x] Type a comment, kill the tab before "Add", reopen: text is restored with the "Restored from this device" state. (`apps/web/src/participant/comment/useDraftTray.test.ts` simulates the killed tab by pre-seeding local storage before the hook mounts.)
- [x] "Add" while the API is unreachable shows "Not saved, retrying" and succeeds when the API returns; the data repo then has exactly one `Action: comment` commit for it. (`useDraftTray.test.ts`'s retry test proves the client reuses the same `client_id` on retry; `apps/api/src/routes/participant/draft.test.ts`'s idempotency test proves the server produces exactly one commit for a repeated `client_id`.)
- [x] After ack, the local-storage entry for that comment is gone. (Same tests, asserted directly.)
- [x] Submit with `pending > 0` is refused with `unsaved_items`; with all saved it flips the record to `submitted` with the judgement and, for `sign_conditional`, sets `signature.conditional`. (`submit.test.ts`; also walked live in the browser.)
- [x] `sign_conditional` is disabled in the UI and rejected by the API when the draft has no comments. (`JudgementPicker.test.tsx` for the UI gate; `submit.test.ts`'s `judgement_requires_comments` case for the API.)
- [x] Publishing a new version while a draft exists shows the mismatch bar; "Move to v3" re-anchors and reports unplaced comments with their quotes still visible. Verified as: server-side re-anchoring + placement reporting (`draft.test.ts`'s rebase test) and the bar's own wiring (`VersionMismatchBar.test.tsx`) — **not** walked together as one live browser flow; see the PR description.
- [x] Touch long-press selection on a phone emulator produces the "Comment" button. (`selection.test.ts` unit-tests the debounced `selectionchange` wiring, per the plan's own "a unit test of the selection handler wiring is enough"; the live browser walkthrough ran at a 390×844 mobile viewport but used a synthetic `mouseup`, not a real touch gesture.)
- [x] Nobody else's comments appear in any participant response (test with two participants). (`draft.test.ts`'s isolation test.)
- [x] A submitted `comment`/`sign`/`sign_conditional` review sends `review-receipt-<ts>` to its author (reusing `notifications`'s existing `decline` listener via the new `submit` event; deferred from [`notifications`](notifications.md), PR #15). (`submit.test.ts`; also confirmed live — the browser walkthrough's data repo shows `notified["review-receipt-<ts>"]` recorded on the participation.)

## Risks / unknowns

- **Selection inside injected HTML** — React re-renders must not tear down the document body node between selection and capture; keep the body in a stable ref. Resolved as designed: `DocumentColumn.tsx` assigns `innerHTML` into a stable ref'd container, matching `DocumentBody.tsx`'s existing pattern.

## Notes

- Git commit dates are second-resolution, which is too coarse for the conflict rule's `saved_at` comparisons (two saves in the same wall-clock second are indistinguishable). Added a small in-memory per-comment timing tracker (`apps/api/src/lib/comment-timing.ts`) that records the server's own wall-clock instant at ack time; falls back to the read model's submission-level timing after a restart (lost in-memory state), which only reduces precision, never correctness, per the same reasoning `lib/idempotency.ts` already documents for its own cache.
- Two real bugs surfaced only by the live browser walkthrough, not by unit tests, and are now fixed: (1) clicking the floating "Comment" button collapses the browser's own text selection, which fires `selectionchange` and — before the fix — cleared the just-opened composer's `pending` state before "Add" could be reached; `DocumentColumn.tsx` now ignores selection-capture callbacks while the composer is open. (2) The inline sign-fields subform (shown when signing for the first time from comment mode) never told its parent about its prefilled `display_name` until the participant edited a field, so the submit button stayed disabled even with a name already showing; fixed with a mount-time `useEffect` that reports the initial values once.
- `submit`'s body carries an optional `reason` not listed in `specs/api/participant.md`'s terse endpoint signature — needed so a `decline` submitted through this general endpoint (rather than the dedicated `POST /decline` route) can still carry the `Reason` trailer `specs/data-model.md` already documents for "submit with decline". Worth folding into that spec's endpoint listing.
- `draft/rebase` intentionally does not rewrite each comment's stored `anchor` — only the submission's `version` field changes; placement is recomputed live for the response (and again by the client on every render), per `inline-comments.md`'s "re-anchoring results are never written back."
- The participant bundle never exposes a version's git commit hash (`specs/data-model.md`: "internal; never shown to participants"), so a client-computed anchor's `commit` field is always `""`. `placeAnchor` doesn't read that field today, so this is inert, not a correctness gap — but if a future change starts using `anchor.commit` for anything, this is the reason a participant-authored anchor's copy of it is meaningless.

## Follow-ups

- Issue — inline tray items are ordered by Map insertion order (the order comments were added), not literal document position; a future pass could sort by each anchor's live placement offset in the currently rendered version instead. Low priority — the document itself still shows highlights in the correct visual position regardless of tray order.
- Issue — overlapping comment highlights (two comments anchored to intersecting text ranges) don't merge into the "count" badge `inline-comments.md` describes; the second range's `surroundContents` call fails and that comment simply shows unplaced (still visible in the tray with its quote). Fine for the common case, worth a real implementation if overlapping annotation turns out to matter in practice.
- Issue — `copy.ts`'s new comment-mode strings land in the eager (always-loaded) participant bundle chunk rather than only comment mode's own lazy chunk, because the whole `copy` module is shared. Within budget today (91.72 KB / 120 KB gzip) but worth splitting into a lazy-loaded comment-mode copy module if the eager budget gets tight later.
