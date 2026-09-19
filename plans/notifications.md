---
status: planned
depends: [api-core]
specs:
  - specs/behaviors/notifications.md
  - specs/screens/preferences.md
---

# Plan: notifications

## Scope

The mailer adapters (Postmark, SMTP, export), message templates, the dispatcher with retries and `notified` idempotency, the daily digest and closing-soon timers, admin `send`/`remind`/`notifications` endpoints, and the preferences screen with the one-click stop link. Out: SMS (**[phase 2]**).

## Implements

- `specs/behaviors/notifications.md` — all phase-1 rows and rules.
- `specs/screens/preferences.md` — all.
- `specs/api/admin.md` — invitations `send`, `remind`, `notifications`, `notifications/retry`.

## Approach

1. `Mailer` interface; Postmark via its HTTP API, SMTP via nodemailer-equivalent for Bun, export writing CSV under a configured path and returning it in the API response. Confirm the exact provider-key environment variable names against this implementation and reconcile `.env.example` + `apps/api/src/plugins/env.ts` — `workspace-bootstrap` used a plausible placeholder set (`POSTMARK_API_KEY`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`) since `specs/architecture.md` only says "provider keys" generically (deferred from `workspace-bootstrap`).
2. Templates as TypeScript functions producing text + minimal HTML, one per event key, sharing a footer with the prefs and stop-optional links; subjects per spec.
3. Dispatcher: consumes the API's event bus (`apps/api/src/events/bus.ts`, from `api-core`) — subscribe to it rather than inventing a second channel. Derives recipients from participations (`notify`, forced-on rules for signers) minus `notified`; 3 attempts with backoff; successes batched into one `Action: send` commit per trigger; failures kept in memory and exposed. Note: `api-core`'s `lib/notify.ts` already computes recipients and commits the publish-triggered idempotency marks (`v<n>`, `disposition-v<n>`, `final-published`) synchronously, so the `{ notified }` counts in the publish response and the admin `notifications` endpoint's `sent` tally are correct without this plan; this plan's dispatcher is what actually *renders and sends* those (and every other event), with retries — reuse `lib/notify.ts`'s recipient computation rather than re-deriving it.
4. Timers: digest at the instance hour (skip when nothing changed), closing-soon 24 h before `signing_closes_at`. The `signing-opened`/`closed` phase observer already exists (`api-core`'s `apps/api/src/events/phase-observer.ts`, wired in `app.ts`'s `onReady`/`onClose` hooks) and publishes those two event types on the bus — subscribe to them here instead of building a second timer.
5. Preferences route `/i/:token/prefs` with forced-on toggles disabled and explained; stop-optional landing.

## Validation

- [ ] Publishing v3 sends exactly one `v3` message to each participation with `every_revision` and none to others; re-running dispatch sends nothing (idempotent via `notified`).
- [ ] A signer with all optional preferences off still receives `signing-opened`, `final-published` and `closing-soon`.
- [ ] A person with both `every_revision` and `daily_digest` receives v3 once; the digest omits it.
- [ ] Signature and revocation confirmations are sent regardless of preferences and contain the personal link.
- [ ] With `MAILER=export`, `people send` produces a CSV with `name,email,subject,link` rows and marks `notified.invitation`.
- [ ] A failed Postmark call retries 3 times, then appears in `GET notifications` as failed; `retry` re-dispatches it.
- [ ] Preferences page shows forced toggles disabled for a signer with the specified explanation; stop-optional turns off exactly the non-forced keys.
- [ ] No message body contains another participant's name, email or comment text (template test over fixtures).
- [ ] `.env.example` and the `@fastify/env` schema's mailer-provider variable names match what `Mailer` actually consumes (deferred from `workspace-bootstrap`).
- [ ] The `forced` key `api-core`'s `lib/prefs.ts` reports for a current signer (currently just `phase_changes`, a documented interpretation of `specs/behaviors/notifications.md`'s "forced on" language for `signing-opened`/`final-published`/`closing-soon`) is confirmed correct or corrected once this plan implements those three sends for real (deferred from `api-core`, PR #10).

## Risks / unknowns

- **Postmark sender verification** — the instance from-address must be a verified sender signature or domain before the first live document.

## Notes

(closeout)

## Follow-ups

(closeout)
