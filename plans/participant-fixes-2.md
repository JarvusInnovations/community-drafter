---
status: done
depends: []
specs:
  - specs/screens/document.md
  - specs/screens/comment-mode.md
  - specs/behaviors/signatures.md
  - specs/behaviors/notifications.md
  - specs/behaviors/document-lifecycle.md
  - specs/behaviors/review-and-judgement.md
  - specs/data-model.md
issues: [62, 63, 64, 65, 68, 71, 73, 59, 38]
pr: 80
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
- `specs/behaviors/review-and-judgement.md` § Dispositions — the label shown to an author where the sentence doesn't fit (added during implementation; see Notes).

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

- [x] Each issue's repro from the persona's `findings.jsonl` no longer reproduces at 390 and 1280 (screenshots in the PR) — except #65, which did not reproduce in the first place; see Notes.
- [x] New tests: re-sign time, unlisted count, conditional `signed_at`, schedule-changed template, submit error surfaced.
- [x] Existing suites pass; participant entry under 120 KB (95.52 KB gzip).
- [x] Issues #62 #63 #64 #68 #71 #73 #59 #38 closed by the PR. **#65 is not closed** — not reproducible; see Notes and Follow-ups.

## Risks / unknowns

- #65 may be an emulator artifact; if a real tap works after investigation, say so in the PR and close the issue as not reproducible with the evidence.

## Notes

- **#65 did not reproduce, and the risk note called it.** At 390x844x2 with touch emulation a real tap on "I have comments first" navigates. To test the hit-target theory the link was reverted *in the live page* to its old inline geometry (20 px tall) and tapped again — it still navigated. It also takes the hit when scrolled flush to the bottom of the viewport, and the sticky bottom bar is not present there: `StickySignBar` renders on `entry.isIntersecting`, so it appears only once the panel is **fully** out of view and can never cover the panel's own links. The 44 px tap target shipped anyway, backed by a new sentence in `screens/document.md` § Design "Links and quiet actions".
- **#63 was a display bug, not a write bug.** The plan's approach said the API "must write a fresh `signed_at`", but dates are not fields (`specs/data-model.md`) — the API already emitted `resigned_at` from the `resign` commit and already cleared `revoked`. The only thing wrong was the card reading `signed_at` unconditionally. `signatureTime()` in `cardState.ts` prefers the later of the two.
- **#59 needed a new trailer, which the plan did not anticipate.** "Write it in the submit path exactly as the sign route does" is impossible as stated: one commit carries one `Action`, and a submission's is `submit`. `specs/data-model.md` grew a `Signature: sign | resign | revoke` trailer, set on a `submit` commit that also writes the participation's `signature` table, and the read model reads it as that signature event. This also gives a decline-through-submit its revocation in the sign/revoke history, which was missing for the same reason.
- **The quoted-excerpt bug was an offset-space mismatch, not a slicing bug.** A block's `text` is whitespace-collapsed and trimmed (`render/block-ids.ts`); a DOM selection's offsets are raw character counts over the block's text nodes. Rendered markdown puts whitespace inside a block often enough — a loose list item is `<li>\n<p>…</p>\n</li>` — that every anchor in such a block was shifted, which is what ate the first character. `normalizeOffsets` (new, in `render/normalize.ts`) keeps the maps both ways and `anchor/dom.ts` converts in both directions, so **highlight placement was silently wrong in the same blocks** and is fixed by the same change. `anchor/dom.ts` also now stops at nested container tags the way the server's `extractBlockText` does.
- **Found while verifying #64 in the browser:** `SignatureFields.emit()` shaped its payload from the `capacity` state variable, which a capacity handler calls in the same tick as `setCapacity` — so switching to official capacity emitted `authorized: true` and no `org`, and the attestation gate stayed open until the participant happened to touch the Organization field. The patch is merged before the shaping now.
- **Disposition wording is now one vocabulary.** The plan named only the email; leaving the participant badges on "Partially addressed"/"Not addressed" would have given authors two words for one outcome, so `specs/behaviors/review-and-judgement.md` § Dispositions gained a sentence naming the four labels and both surfaces use them.
- **`.doc-body` had no table styles at all**, so the scroll container came with the minimum border/padding/header styling a table needs to read as one.
- Two `#73` bullets were deliberately not carried — the plan's list omitted them and both are judgement calls rather than defects. See Follow-ups.
- **Rebased three times onto a moving `develop`** (#76, #79, #82, #85 all landed on these files mid-flight). Conflicts were resolved keeping both sides: `ReadOnlyStatusCard` is gone (#76 folded it into `StatusCard`'s `readOnly` prop), the signed-state line lives on #79's focusable `h2` and in its live region, the review tray keeps #79's `<form>`/`type="submit"`, and the inline composer keeps #79's `role="dialog"` and label on this plan's auto-growing textarea. One upstream test was updated rather than kept: `ViewAsScreen`'s official-capacity invitee now expects "Sign for Example Alliance".
- **The Markdown-table item landed in parallel.** #82 (redline-quality) added an equivalent `.doc-body table` rule for the compare view; the rebase took theirs, so this plan contributes only the sentence in `screens/document.md` § Display Rules 5. Re-measured after the rebase: at 390 the table is `clientWidth 308 / scrollWidth 509` and the page stays 390 wide.
- Verification instance: a scratch `initDataRepo` data repo with `MAILER=export`, never the real one. Screenshots (16, at 1280x900 and 390x844) were handed off as `~/Downloads/participant-fixes-2-screenshots.tgz` on mbp-2024 rather than committed.

## Follow-ups

- Issue [#81](https://github.com/JarvusInnovations/community-drafter/issues/81) — the two Phase 3 copy observations this plan did not carry: whether `title` should be required in official capacity, and whether the signing confirmation should carry a preferences link despite being transactional.
- Tracked as: issue [#65](https://github.com/JarvusInnovations/community-drafter/issues/65) stays open, not reproducible against the evidence in PR #80. Close it, or reopen with a capture from a physical device.
