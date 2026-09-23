---
status: in-progress
depends: [quieter-clock]
issues: []
specs:
  - specs/behaviors/notifications.md
---

# Plan: quiet-declines

## Scope

`quieter-clock` left one question for the owner: a person who has declined still
receives `signing-opened`, `closing-soon` and `schedule-changed` once they have opened
their link, and `closed` whenever `phase_changes` is on. The owner's decision
(2026-09-23): a person whose current position on a document is **decline** hears
nothing further about that document's clock or outcome.

**In:**

1. The clock audience (`signing-opened`, `closing-soon`, `schedule-changed`) excludes
   a declined participant.
2. `closed` excludes a declined participant.
3. `final-published` excludes a declined participant, in both halves.
4. "Declined" means the current position: the person's latest submitted judgement is
   `decline` and they hold no unrevoked signature. A later signature replaces the
   decline and makes them an ordinary signer; re-opening the link, or starting a draft
   they never submit, leaves them declined.

**Out:** transactional receipts (their own `review-receipt`, signature and revocation
confirmations), which keep going. `disposition-v<n>` keeps going: a decliner who left
comments should hear what happened to them. `v<n>` and `digest` are revision news the
person opted into, not clock or outcome, and are unchanged. Reminders already skip a
decliner (their status is `declined`, never `unopened` or `opened`, and declining turns
`reminders` off).

## Implements

- `specs/behaviors/notifications.md` § Messages — the recipient column for
  `signing-opened`, `closing-soon`, `schedule-changed`, `closed` and
  `final-published`; § Sending — the rule that a declined participant hears nothing
  further about the clock or outcome, and what they still get.

## Approach

1. Spec first: the table rows and a § Sending rule.
2. API: one `isDeclined` predicate in `notifications/triggers.ts` (no unrevoked
   signature, and `readModel.getPosition(...)?.judgement === "decline"`), applied in
   `clockMessageRecipients`, `closedRecipients` and
   `finalPublishedCommenterRecipients`. The signer half of `final-published`
   (`lib/notify.ts`) already requires a current signature, which a decliner cannot
   hold, so it needs no change beyond saying so.
3. Tests: a declined opened invitee gets none of the five; still gets their own
   receipt and `disposition-v<n>`; a decliner who later signs receives
   `final-published`.

## Validation

- [ ] A declined opened invitee with `phase_changes` on receives none of
      `signing-opened`, `closing-soon`, `schedule-changed`, `closed`,
      `final-published`.
- [ ] The same person still receives their own `review-receipt` and
      `disposition-v<n>`.
- [ ] A decliner who later signs receives `final-published`.
- [ ] Reminders skip a decliner (confirmed, unchanged).
- [ ] Gates in `apps/api`: lint, format:check, typecheck, tests.

## Risks / unknowns

- The position is the latest *submitted* submission, so a decliner who later submits a
  plain comment is no longer declined and rejoins the clock audience. That matches
  "current position" and is intended.

## Notes

## Follow-ups
