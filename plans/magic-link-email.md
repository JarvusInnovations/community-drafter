---
status: planned
depends: []
specs:
  - specs/api/auth.md
  - specs/behaviors/operators.md
  - specs/behaviors/notifications.md
---

# Plan: magic-link-email

## Scope
Short-code magic links and a human-shaped sign-in email. Out: DMARC/DNS (managed elsewhere), any change to session or CLI tokens.

## Implements
- `specs/api/auth.md` — `login`/`device` email `callback?code=`; callback resolves the code.
- `specs/behaviors/operators.md` — § Sign-in: magic link.
- `specs/behaviors/notifications.md` — the `operator-magic-link` row.

## Approach
1. An in-memory `MagicCodeStore` (24-char base62 code → signed magic token, 15-minute TTL, delete on use), alongside the used-`jti` store.
2. `sendMagicLink` mints the token, stores it under a code, and emails a link with only the code; the email gets a name greeting, the trigger sentence (web or device code with the user code), a button, plain-text alternative, expiry and ignore lines.
3. `GET /auth/callback?code=` resolves and deletes the code, then the existing verification path.
4. Tests: link contains no JWT; unknown/expired code fails; code is single-use; device-flow return path still round-trips; template contains the trigger sentence and no token.

## Validation
- [ ] The emailed link matches `/auth/callback\?code=[A-Za-z0-9]{24}$` and the message body contains no `eyJ` token fragment.
- [ ] A code works once; a second use and an unknown code render the failure page.
- [ ] The device-code email names the user code; the web email says "on the web".
- [ ] Existing auth and CLI e2e suites pass.

## Risks / unknowns
- **Restart mid-link** forgets the code; the failure page tells the person to request a new link.

## Notes
(closeout)

## Follow-ups
(closeout)
