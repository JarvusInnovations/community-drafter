---
status: planned
depends: []
specs:
  - specs/screens/document.md
  - specs/screens/comment-mode.md
  - specs/behaviors/signatures.md
  - specs/behaviors/notifications.md
  - specs/behaviors/document-lifecycle.md
  - specs/data-model.md
---

# Plan: participant-fixes-2

## Scope

Every participant-facing defect the twelve Phase 3 personas hit on 2026-09-20, in one PR. These are bugs against behavior the specs already state, plus the copy and layout batch. Issues: #62, #63, #64, #65, #68, #71, #73, #59, #38. Out: new behavior (signature version, audience and consent, accessibility, onboarding), which have their own plans.

## Implements

- `specs/screens/document.md` — Display Rules 3 (signed state shows the current signature and time), 7 (counts sentence), 8; § Design "Links", "Signatories card".
- `specs/screens/comment-mode.md` — Actions "Submit" (validation errors are shown, never swallowed).
- `specs/behaviors/signatures.md` — re-sign after removal is a new signature with its own time.
- `specs/behaviors/document-lifecycle.md` § Extension — "announced ... with old and new times" → `specs/behaviors/notifications.md` `schedule-changed` content.
- `specs/data-model.md` — derived status literal becomes `signed_conditional` (amend the spec; the web type already uses it).

## Approach

1. **#62** `EditSignatureForm`: the first Save click is lost because an input's blur commit re-renders before the click lands; commit on submit only (form `onSubmit`), never on blur, and show a saving state.
2. **#63** Re-signing shows the original time: the API must write a fresh `signed_at` (and clear `revoked`/`revoked_at`) on a sign after removal; the card shows `resigned_at ?? signed_at` only when it is later. Add a route test: sign, remove, sign again → the panel time is the third action's.
3. **#64** Comment-mode submit: render the API's `validation_failed` message under the button (role=alert), and disable the button with a reason until the official-capacity attestation is checked when the capacity is official.
4. **#65** "I have comments first" not answering a real tap on phones: reproduce with the touch viewport; the likely cause is the fixed bottom bar or a sibling overlay intercepting the tap near the bottom of the panel; fix the layering or the observer threshold so the bar never covers the panel's own links; verify with a tap, not `.click()`.
5. **#68** Signatories summary: an unlisted signer must count once ("2 individuals, and 1 other who asked not to be listed"); fix in the summary builder and add a unit test.
6. **#71** `schedule-changed`: the extend route publishes the previous values; the template says "Comments close moved from … to …" for each deadline that changed.
7. **#59** A conditional signature made through comment-mode submit lacks `signed_at`; write it in the submit path exactly as the sign route does; test `signatures list --json` shape for both.
8. **#38** `participationStatus` emits `signed_conditional`; the people screen mapping and spec follow.
9. **#73** copy and layout: neutral description placeholder ("your neighborhood, profession, or organization"); the official-capacity confirmation and button name the organization ("Sign for St. Brigid Parish Council"); attestation error says what to do; participant `ConfirmDialog` centered like the admin `DialogShell`; signatories chips wrap the role line instead of truncating; Markdown tables in `.doc-body` get a horizontal scroll container; the selection "Comment" pill sits above the open phone sheet; composer and tray textareas grow with content; "Show more" on a saved comment works; preferences page links back to the document; disposition email uses "Accepted", "Partly addressed", "Declined", "Noted"; quoted excerpt keeps its first character.

## Validation

- [ ] Each issue's repro from the persona's `findings.jsonl` no longer reproduces at 390 and 1280 (screenshots in the PR).
- [ ] New tests: re-sign time, unlisted count, conditional `signed_at`, schedule-changed template, submit error surfaced.
- [ ] Existing suites pass; participant entry under 120 KB.
- [ ] Issues #62 #63 #64 #65 #68 #71 #73 #59 #38 closed by the PR.

## Risks / unknowns

- #65 may be an emulator artifact; if a real tap works after investigation, say so in the PR and close the issue as not reproducible with the evidence.

## Notes

(closeout)

## Follow-ups

(closeout)
