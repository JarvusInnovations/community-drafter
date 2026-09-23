---
status: done
depends: []
issues: [116]
pr: 117
specs:
  - specs/behaviors/signatures.md
  - specs/api/participant.md
  - specs/screens/document.md
---

# Plan: clear-descriptor

## Scope

Two small fixes found on a live document.

1. **Clearing an optional listing field is ignored (#116).** Emptying "How would you
   like to be described? (optional)" in "Change how you're listed" and saving keeps
   the old descriptor; a single space clears it. The PATCH has no way to say
   "cleared" as distinct from "unchanged".
2. **Same-day timeline labels.** The points under the timeline track read "Opened
   Sep 22 / Comments close Sep 23 / Signatures due Sep 23" when all three fall on
   today, which tells a reader nothing about *when*. A deadline chip that has passed
   today reads just "Sep 23" for the same reason.

**In:** the PATCH rule for display fields (omitted = unchanged; present and empty
after trimming = cleared; whitespace-only is empty), applied to `descriptor`, `org`,
`title` and `display_name`, and the edit form sending an empty value when a field is
emptied. The today-shows-the-time rule for the timeline's point labels (and the
not-yet-open line's planned dates) and for a passed chip's big text.

**Out:** `POST /signature` (it already writes only what the body carries), any
change to how a descriptor is displayed, and the chip's second line, which already
carries the full date and time.

## Implements

- `specs/behaviors/signatures.md` § Changing how a signature is listed — the clearing
  rule.
- `specs/api/participant.md` § `PATCH /i/:token/api/signature` — omitted vs. empty in
  the body, and the two refusals (blank name, blank official title).
- `specs/screens/document.md` § Display Rules 2 (Timeline) and § Design "Dates" — a
  point on today shows the short time; a chip whose deadline passed today reads
  "Comments closed today at 11 AM".

## Approach

1. Spec first, one `docs(specs)` commit.
2. API: normalise each string display field in the PATCH body — `undefined` leaves
   the stored value, a trimmed empty string removes the field, anything else is
   stored trimmed. A blank `display_name` is refused `validation_failed`
   (`field: display_name`); a blank official `title` keeps its existing refusal.
   `listingChanged` compares the normalised values.
3. Web: `EditSignatureForm` sends the trimmed field as-is (empty included) instead of
   `descriptor || undefined`.
4. Web: a `formatPointDate(iso, now)` in `format.ts` returns the short time ("11 AM",
   "2:30 PM") when the instant falls on the viewer's local today, else the existing
   date-only form. `Timeline` uses it for the three points and the not-yet-open line,
   and a passed chip on today reads `today at <time>`.

## Validation

- [x] PATCH with `descriptor: ""` removes the stored descriptor.
- [x] PATCH with `descriptor: "   "` removes it too.
- [x] PATCH that omits `descriptor` leaves it unchanged.
- [x] PATCH with a blank `display_name` is refused 422 `validation_failed`.
- [x] A blank `title` on an official signature is still refused.
- [x] Emptying the descriptor in the edit form sends `descriptor: ""`.
- [x] Timeline, fixed clock: a point on today shows the time, one on yesterday shows
      the date; a chip whose deadline passed today reads "today at …".
- [x] Gates in `apps/api` and `apps/web`: lint, format:check, typecheck, tests; web
      build and bundle-size check.

## Risks / unknowns

- Clearing `org` on an official signature: an empty `org` is a change of
  organization, so it needs the attestation, and an official signature without an
  organization would be invalid anyway. The POST refuses a missing `org`; the PATCH
  should refuse a blank one the same way.

## Notes

- **Root cause of #116 was two layers.** The form sent `descriptor || undefined`, so an
  emptied field never reached the server. Behind it, the route merged with `??` and
  wrote through gitsheets' RFC 7396 merge patch, where an absent key keeps the stored
  value, so even a correct body could not remove a field. A single space "worked" only
  because it was stored verbatim. A cleared field is now sent to the patch as `null`.
- **A blank official `org` is refused**, not cleared, alongside the blank title and
  blank name: an official signature cannot stand without its organization, and the
  POST already refuses one.
- **Values are stored trimmed**, and `listing-changed` compares the normalised values,
  so re-sending an unchanged name with stray spaces does not count as an edit.
- **The PATCH body gained a JSON schema** (string text fields, boolean flags); the
  trimming would otherwise throw a 500 on a non-string.
- **Chip wording**: the brief suggested "Closed at 11 AM"; the chip's title already
  reads "Comments closed", so the big text is "today at 11 AM" and the pair reads
  "Comments closed today at 11 AM", matching "Comments closed Sep 24".
- The full API suite timed out on unrelated tests at the default 5 s under heavy host
  load; it passes 300/300 with `--timeout 30000`.

## Follow-ups

- None.
