---
status: done
depends: []
issues: []
pr: 114
specs:
  - specs/behaviors/notifications.md
  - specs/screens/preferences.md
  - specs/principles.md
---

# Plan: quieter-clock

## Scope

A live document ran a two-hour signing window and every invitee who had opened their
link got three messages in seventeen minutes: "signing is open" at 15:00:26, "signing
window closes soon" at 15:00:55 — the 24-hour lead was already in the past, so the
warning fired the moment the window opened — and "schedule updated" at 15:17 when the
operator extended. The extension notice also reached four people who had never opened
their invitation, and the whole sequence went to people who had already signed.

**In:** three rules on who hears the clock and when.

1. `closing-soon` keeps a six-hour quiet period after the document's `signing-opened`
   send, and uses the window's midpoint instead of a 24-hour lead when the window is
   shorter than 24 hours; a midpoint inside the quiet period means no warning at all.
2. `schedule-changed` goes to the engaged only — the same recipient rule as
   `signing-opened`: `phase_changes`, link opened. Never to someone who has only been
   sent an invitation.
3. A current signer receives no clock messages. `signing-opened`, `closing-soon` and
   `schedule-changed` all go to opened, non-signing invitees. A signer hears
   `final-published` (still forced on, confirm/remove variant included), their own
   receipts, and `disposition-v<n>`.

**Out:** `closed`, which is the one terminal wrap-up message rather than a countdown
and keeps its own row (signers and commenters with `phase_changes`). The reminder
machinery, which is and stays the tool for the never-opened. Any change to
`forcedKeys` — `phase_changes` stays forced for a current signer, because
`final-published` and `closed` still ride on it; only the explanation changes.

## Implements

- `specs/behaviors/notifications.md` § Messages — the `signing-opened`, `closing-soon`
  and `schedule-changed` rows and the "Forced on" sentence; § Sending — the two new
  rules with their numbers; § Principles — the `Just sign it for now` gloss.
- `specs/screens/preferences.md` § Display Rules — the forced-on explanation now
  covers the final text alone.
- `specs/principles.md` § Just sign it for now — the promise, and the owner's call
  recorded in the *Why*.

## Approach

1. Spec first: the three rows, a § Sending section stating the quiet period (6h), the
   lead time (24h) and the short-window midpoint, the preferences copy, the principle.
2. API: collapse `signingOpenedRecipients` / `closingSoonRecipients` /
   `scheduleChangedRecipients` into one `clockMessageRecipients`, since the spec now
   states one rule for all three. `ClosingSoonScheduler` computes a due moment
   (scheduled time, pushed past the quiet period) and sends nothing when that moment
   falls on or after `signing_closes_at`.
3. Copy: `closing-soon` and `signing-opened` both addressed a signer ("Your name is on
   it"; "if it is, nothing changes unless you remove it"). Neither reaches a signer
   now, and `closing-soon` no longer always means "in about a day", so both are
   rewritten for the reader who has not signed.
4. Web: the forced-on explanation.

## Validation

- [x] `closing-soon` is not sent inside the six hours after the document's
      `signing-opened` send.
- [x] A signing window shorter than 24 hours schedules `closing-soon` at the window's
      midpoint; a window long enough for the midpoint to clear the quiet period gets
      the warning there.
- [x] A two-hour window — the live case — sends no `closing-soon` at all.
- [x] A window of 24 hours or more sends `closing-soon` at the 24-hour mark.
- [x] `schedule-changed` excludes invitees who have never opened their link, and
      excludes current signers.
- [x] `signing-opened` excludes current signers.
- [x] `final-published` still reaches a current signer with every optional preference
      off.
- [x] A signer who removes their name is eligible for clock messages again.
- [x] Gates in `apps/api` and `apps/web`: lint, format:check, typecheck, tests.

## Risks / unknowns

- The quiet period is anchored to the earliest `notified.signing-opened` on the
  document's participations, which is the record of the send rather than a separate
  stored moment. A document whose `signing-opened` reached nobody has no anchor and
  therefore no quiet period; the 24-hour/midpoint rule alone applies.
- `notified["closing-soon"]` is still a single mark per participation, so a window
  extended after the warning went out does not produce a second one. Unchanged, and
  out of scope here.

## Notes

- **One rule, one function.** The three clock events had three recipient functions
  with three different rules; the spec now states one rule, so the code has one
  `clockMessageRecipients`. `closed` and `final-published`'s commenter half keep
  their own, and the comments say why.
- **`closed` stayed out on purpose.** It is the terminal notice that the list is
  final, not a countdown a signer has already answered, and it rides on
  `phase_changes` like any other subscription. Excluding a signer from it would
  have told the person who signed least about how the thing they signed ended.
- **`forcedKeys` is unchanged.** A current signer still has `phase_changes` forced,
  because `final-published` and `closed` still ride on it; only the explanation
  changed. Turning the force off would have made `closed` optional for signers as a
  side effect of a copy change.
- **The quiet period is anchored to the record, not to a new field.** The earliest
  `notified["signing-opened"]` across the document's participations is the only place
  that moment exists, and taking the earliest anchors it to the original batch rather
  than to a straggler a retry picked up later.
- **Both clock templates had to be rewritten**, not just re-targeted. `closing-soon`
  said "Your name is on it" and "close in about a day"; neither is true of its new
  reader or its new schedule.
- **Declines are unchanged.** A decliner with `phase_changes` on is still in the clock
  audience once they have opened their link — the brief assumed they were already
  excluded, and nothing in the code or the spec excluded them before this change
  either. Left as found rather than widened silently.

## Follow-ups

- **Declined invitees and the clock audience.** A person who has declined still
  receives `signing-opened`, `closing-soon` and `schedule-changed` if they opened
  their link and left `phase_changes` on. That may be right (they may change their
  mind before the window shuts) or may be the same noise this plan removed for
  signers. Worth a decision; **tracked as** a question for the owner, not a spec gap.
- **A second schedule change sends nothing.** `notified["schedule-changed"]` is a
  single mark, so only the first extension on a document is announced to a given
  person. Pre-existing, out of scope here, and worth its own plan if an operator ever
  moves a deadline twice.
