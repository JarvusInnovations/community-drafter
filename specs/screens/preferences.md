# Screen: Notification Preferences

## Route

`/i/<token>/prefs`. Also reachable through the "Manage how we contact you" link every participant email carries, and through the one-click "stop all optional messages" link beside it, which lands here with the change already applied and a confirmation banner (`behaviors/notifications.md` § Content rules).

## Data Requirements

The invitation's `notify` table and the person's channel details (email shown masked, e.g. `j***@example.org`; phone if present **[phase 2]**).

## Display Rules

- Title: "How we contact you about *Document title*".
- Channel: email (always available) and **[phase 2]** text message (only if a phone is on file; otherwise a line "add a mobile number" is out of scope for phase 1 and not shown).
- Two toggles with plain descriptions, in this order:
  1. "Replies to my comments" — `my_comments_addressed`. "When the team answers your comments in a new version and asks us to tell you."
  2. "Reminders" — `reminders`. "A nudge before a deadline if you haven't answered yet. Turns off by itself once you sign, comment or decline."
- A note under the toggles saying what is always sent, and nothing else: "We'll always confirm what you do here (signing, removing your name, comments), and the team may write to ask you to confirm your signature, to tell you there is more time to sign, or to say the statement was delivered." Nothing is described that the system does not send (`behaviors/notifications.md` § Messages).
- "Stop all optional messages" button, and a save confirmation.

## Actions

Change either toggle → saved immediately with a confirmation; "Stop all optional messages" → sets both off.

## Navigation

From the document footer and every participant email — transactional messages carry the link too, so a signer who keeps only the signing receipt can still reach this screen. Back to document.

## Principles

**Inherited**
- [Essentials always, everything else opt-in](../principles.md#essentials-always-everything-else-opt-in).
- [Every email asks something of its reader](../principles.md#every-email-asks-something-of-its-reader): there is nothing here to subscribe to that asks nothing — no revision feed, no daily summary, no milestones.
