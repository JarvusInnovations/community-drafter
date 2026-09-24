---
status: done
pr: 15
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

- [x] Publishing v3 sends exactly one `v3` message to each participation with `every_revision` and none to others; re-running dispatch sends nothing (idempotent via `notified`).
- [x] A signer with all optional preferences off still receives `signing-opened`, `final-published` and `closing-soon`.
- [x] A person with both `every_revision` and `daily_digest` receives v3 once; the digest omits it.
- [x] Signature and revocation confirmations are sent regardless of preferences and contain the personal link.
- [x] With `MAILER=export`, `people send` produces a CSV with `name,email,subject,link` rows and marks `notified.invitation`.
- [x] A failed Postmark call retries 3 times, then appears in `GET notifications` as failed; `retry` re-dispatches it. (Verified with a `FakeMailer` forced-failure stand-in for the retry/failure *mechanism* — the real Postmark adapter's live behavior is unverified; see Notes.)
- [x] Preferences page shows forced toggles disabled for a signer with the specified explanation; stop-optional turns off exactly the non-forced keys. (Verified two ways: an HTTP test, and a manual check with a real browser against a running dev server — see Notes.)
- [x] No message body contains another participant's name, email or comment text (template test over fixtures).
- [x] `.env.example` and the `@fastify/env` schema's mailer-provider variable names match what `Mailer` actually consumes (deferred from `workspace-bootstrap`).
- [x] The `forced` key `api-core`'s `lib/prefs.ts` reports for a current signer (currently just `phase_changes`, a documented interpretation of `specs/behaviors/notifications.md`'s "forced on" language for `signing-opened`/`final-published`/`closing-soon`) is confirmed correct or corrected once this plan implements those three sends for real (deferred from `api-core`, PR #10).

## Risks / unknowns

- **Postmark sender verification** — the instance from-address must be a verified sender signature or domain before the first live document.

## Notes

- **Real Postmark/SMTP delivery is unverified.** No live credentials exist in the dev/CI environment. Both adapters were exercised structurally (construction, request/message shaping) and the SMTP adapter was confirmed to construct and hold a `nodemailer` transport under Bun with no native bindings — neither was exercised against a real inbox. The retry-then-fail-then-`retry`-succeeds *mechanism* is fully covered with a `FakeMailer` standing in for any provider.
- **A real bug the test suite missed, caught only by a manual browser check**: `buildPrefsView` originally returned a forced key's *raw stored* preference value rather than overriding it to `true`. A signer whose `phase_changes` had been off *before* they signed would see "Milestones" render unchecked-and-disabled instead of the spec's "shown on and disabled." No HTTP/unit test exercised this specific stored-then-forced sequence; a manual pass with `chrome-devtools-axi` against a running dev server (seeded via a throwaway boot script, since deleted) surfaced it immediately. Fixed in `lib/prefs.ts`; a regression test would need either a DOM test runner (this repo has none yet) or an API-level test that signs a participant who previously had `phase_changes: false` and asserts the response value — worth adding once `participant-sign-flow`'s route shell lands and a first DOM test harness exists.
- **`EventBus.publish` is now `async`.** Every existing call site was updated to `await` it so the dispatcher's bus-driven sends (`signing-opened`/`closed`/`schedule-changed`, `sign`/`resign`/`revoke`/`decline`, `invite`/`send`/`remind`) complete before the triggering HTTP response returns — this is what makes the dispatcher's behavior deterministically testable over `server.inject`, and it's a backward-compatible change (an un-awaited `publish()` still just doesn't wait, same as before).
- **`final-published`'s recipient set is split across two code paths on purpose**: current signers are computed and pre-marked synchronously by `lib/notify.ts` (unchanged from `api-core`) and delivered with `markNotified: false`; commenters (`notifications/triggers.ts`'s `finalPublishedCommenterRecipients`) are derived live and delivered with `markNotified: true`. The two sets are disjoint (`!isCurrentSigner`), so there's no double-send risk.
- **"Commenter" is read broadly** (`triggers.ts`): "has a submitted submission", which today only means `decline` submissions — `comment-mode`'s general submit endpoint isn't built yet. See Follow-ups.
- The `.env.example`/`env.ts` variable names `workspace-bootstrap` guessed (`POSTMARK_API_KEY`, `SMTP_HOST`/`PORT`/`USER`/`PASSWORD`) turned out to already match what the real adapters need; only `EXPORT_CSV_PATH` and `INSTANCE_DIGEST_HOUR` were net-new additions.
- `apps/api/src/routes/smoke.test.ts`'s idempotency-replay test previously asserted exactly 1 commit per signature POST; a real execution now makes 2 (the `sign` commit plus the signature-confirmation's `notified` mark), so the assertion was updated to `toBe(2)` — what it actually guards (a replay adds zero more) is unchanged.

## Follow-ups

- Deferred to [`comment-mode`](comment-mode.md) — wire `review-receipt-<ts>` onto the general submit endpoint's own event (today it only fires for `decline`, which is the only submitted-submission path that exists yet), and confirm/refine `finalPublishedCommenterRecipients`'s "commenter = has a submitted submission" reading once non-decline submissions exist.
- Tracked as: real Postmark/SMTP delivery is unverified in this environment (no live credentials) — first live document should include a smoke send before going out to real invitees, and the Postmark sender/domain must be verified first (see Risks).
