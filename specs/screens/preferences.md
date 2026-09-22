# Screen: Notification Preferences

## Route

`/i/<token>/prefs`. Also reachable through the "Manage how we contact you" link every participant email carries, and through the one-click "stop all optional messages" link beside it, which lands here with the change already applied and a confirmation banner (`behaviors/notifications.md` § Content rules).

## Data Requirements

The invitation's `notify` table, the person's channel details (email shown masked, e.g. `j***@example.org`; phone if present **[phase 2]**), and the person's role-derived forced-on state (current signer or not).

## Display Rules

- Title: "How we contact you about *Document title*".
- Channel: email (always available) and **[phase 2]** text message (only if a phone is on file; otherwise a line "add a mobile number" is out of scope for phase 1 and not shown).
- Toggles with plain descriptions, in this order:
  1. "Every new version" — every_revision. "One email each time the text is revised, with what changed."
  2. "Daily summary" — daily_digest. "At most one email a day, only on days something changed."
  3. "Milestones" — phase_changes. "When comments close, when the final text is published, when the signing window closes, and if a deadline moves."
  4. "Replies to my comments" — my_comments_addressed.
  5. "Reminders" — reminders. "A nudge if you haven't acted yet. Turns off by itself once you sign, comment or decline."
- If the person is a current signer, "Milestones" is shown on and disabled with: "Because you signed, we'll always tell you when the final text is published." That is the whole of the forced-on promise: a current signer is out of the clock audience and gets no message when the signing window opens, when it is about to close, or when a deadline moves (`behaviors/notifications.md` § Sending).
- A note under the toggles: "We'll always confirm when you sign or remove your name." 
- "Stop all optional messages" button, and a save confirmation.

## Actions

Change any toggle → saved immediately with a confirmation; "Stop all optional messages" → sets 1, 2, 4, 5 off and 3 off unless forced.

## Navigation

From the document footer and every participant email — transactional messages carry the link too, so a signer who keeps only the signing receipt can still reach this screen. Back to document.

## Principles

**Inherited**
- [Essentials always, everything else opt-in](../principles.md#essentials-always-everything-else-opt-in).
- [Just sign it for now](../principles.md#just-sign-it-for-now): the forced-on milestone messages are the other half of the early-sign promise, and the copy says so.
