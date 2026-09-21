---
status: in-progress
depends: []
specs:
  - specs/behaviors/notifications.md
  - specs/screens/preferences.md
issues: [81]
---

# Plan: prefs-link

## Scope

Give every **participant** message the quiet preference footer that subscription
messages already carry: "Manage how we contact you" → `/i/<token>/prefs` and the
one-click "stop all optional messages" link. That adds the footer to the five
transactional participant messages — `invitation`, `signature-confirmation-<ts>`,
`revocation-confirmation-<ts>`, `listing-changed-<ts>` and `review-receipt-<ts>` —
without changing what makes them transactional: they are still sent
unconditionally, and the stop-optional link still only turns *optional* messages
off.

Closes the second half of issue #81 (the first half — title required in official
capacity — shipped in PR #87).

Out of scope: operator messages (`operator-*`). An operator has no participation
and no preferences, so there is nothing for a preference link to address
(`specs/behaviors/notifications.md` § Operator mail). Also out: the preferences
screen itself, the stop-optional endpoint, and the set of preferences.

## Implements

- `specs/behaviors/notifications.md` § Content rules — the footer rule moves from
  "subscription messages" to "every message to a participant", and the § Messages
  catalogue's "Transactional?" column says what "transactional" now means (sent
  unconditionally), not "no preference links".
- `specs/behaviors/notifications.md` § Content rules "Shape" — the small-print
  bullet's "for subscription messages" qualifier goes.
- `specs/screens/preferences.md` § Route and § Navigation — reached from every
  participant email, not just subscription email.

## Approach

1. Spec first: amend `notifications.md` § Content rules (the footer bullet and the
   "Shape" small-print bullet) with the rationale — the signing receipt is the one
   message people keep, so it is where they look for the controls — and restate the
   catalogue column so "yes" reads as "sent unconditionally".
   Ripple `screens/preferences.md`'s two "every subscription email" phrases.
2. Code: `notifications/templates.ts`'s `transactional()` helper renders the same
   `footerLinks` as `subscription()`. Both helpers already receive the full
   `RecipientContext`, which carries `prefsLink` and `stopOptionalLink`, so no
   context, link-builder or dispatcher change is needed. `lib/mailer/shell.ts` is
   untouched: it already renders `footerLinks` for whoever passes them, and the
   operator path (`notifications/operator-mail.ts`, `auth/routes.ts`) passes none.
3. Tests: each transactional participant template's rendered text and HTML carry
   both links with the token in the URL; operator mail carries neither; the
   `renderEmail` shell tests are unchanged and still pass.

## Validation

- [ ] `specs/behaviors/notifications.md` states the footer rule for every
      participant message and keeps operator messages excluded.
- [ ] All five transactional participant templates render both footer links, in
      the text part and the HTML part, with the personal-link token in the URL.
- [ ] Operator messages still render no preference link (the existing
      `operators.test.ts` assertion holds).
- [ ] `renderEmail` shell tests unchanged and passing.
- [ ] `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun test` green
      in `apps/api`.
- [ ] Issue #81 closed by the PR.

## Risks / unknowns

- The existing template test asserts the signing confirmation does *not* contain
  the prefs link; that assertion is the old rule and is replaced, not worked
  around.
- The footer must stay quiet: it is small print, not a second call to action, and
  the one-button rule ("exactly one button") is unaffected because footer links
  render as plain links.

## Notes

## Follow-ups
