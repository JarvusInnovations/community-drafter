---
status: planned
depends: []
specs:
  - specs/behaviors/notifications.md
---

# Plan: participant-email-shape

## Scope

Give every participant message the shape the operator sign-in email already has (`behaviors/notifications.md` § Content rules "Shape"): first-name greeting, one or two sentences in the sender's voice, the clock as a sentence, one action button with the plain URL beneath, small print, and an HTML part in the app's type and accent. One shared email shell renders both the participant templates and the sign-in email so they look like they come from the same place. Out: new events, SMS, preference changes.

## Implements

- `specs/behaviors/notifications.md` — § Content rules, "Shape".

## Approach

1. `apps/api/src/lib/mailer/shell.ts`: `renderEmail({ greeting, body, button, alsoLink?, smallPrint, footerLinks? })` → `{ text, html }`, escaping HTML, accent `#2457f5`, Inter/system type, 520 px measure.
2. `RecipientContext` gains `firstName`, `senderName` and `clockLine` (built in `context.ts` from both deadlines and the phase; year dropped when current); `nextDeadline`/`phaseLabel` retire.
3. Rewrite each template in `templates.ts` on the shell with an action label per event; subjects unchanged.
4. `auth/routes.ts` `sendMagicLink` uses the shell (same words as today).
5. Tests: existing template and integration assertions keep passing; add a shell test that the text and HTML parts carry the same URL and that no template emits a second button.

## Validation

- [ ] Every template's text part contains the greeting, the button label with its URL, the small print, and (subscription messages) both preference links.
- [ ] The sign-in email still yields a 24-character code to the CLI login test.
- [ ] A rendered invitation and a rendered version notice, sent through Postmark to the maintainer, read as described in the spec.

## Risks / unknowns

- Changing `RecipientContext` touches every render call site (`dispatcher`, `digest`, `closing-soon`, admin `versions` route); the type checker finds them all.

## Notes

(closeout)

## Follow-ups

(closeout)
