---
status: done
depends: []
specs:
  - specs/behaviors/notifications.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/data-model.md
issues: [52, 58]
pr: 85
---

# Plan: send-truth

## Scope

Make the sending counts true (#52) and reminders safe (#58). Invitations are marked `sent_at` and `notified.invitation` only when the message was actually accepted by the mailer, in the same commit; a failed send stays unsent and visible in the failures list. `people remind` refuses to nudge anyone who received any message from the document within a minimum interval (default 48 hours, `--min-age`), and its summary reports what it actually sent.

## Implements

- `specs/behaviors/notifications.md` § Sending — "recorded on success" applies to invitations too; every send action reports deliveries and failures; the reminder interval rule. Adds the local principle **a sent count is a delivery count**.
- `specs/api/admin.md` — `POST .../open` reports `invitations: { sent, failed, failures }`; `.../send` reports `sent`, `failed`, `skipped`, `failures` in place of `queued`; `.../remind` gains `min_age_hours` and reports `sent`, `failed`, `skipped_recent`, `skipped_pref`.
- `specs/api/admin-cli.md` — `people remind --min-age <hours>`, and what `people send` / `docs open` print.
- `specs/data-model.md` — `sent_at` is written on delivery in the same commit as `notified.invitation`; `notified."reminder-<n>"` timestamps beside the `reminder` count; a `notified` timestamp means delivered, and `links-exported` is not a message.

## Approach

1. The open and send routes stop pre-marking; they call the dispatcher with `markNotified: true` and an `alsoSet: { sent_at }` option so `sent_at` lands in the dispatcher's one success commit.
2. The funnel's SENT reads `sent_at` as before, which is now true.
3. Remind: filter by the newest `notified.*` timestamp per person against `min_age_hours`; count outcomes; the CLI prints them.
4. Tests: a mailer that fails for one recipient leaves that participation unsent and listed under failures; a second `send` picks it up; remind skips a person mailed ten minutes ago.

## Validation

- [x] The "Samuel Park, MD" scenario replayed with a failing mailer shows SENT 7 of 8 and one failure with a reason. (`apps/api/src/routes/admin/documents.test.ts` — `open` returns `{ sent: 7, failed: 1, failures: [{ person, error }] }`, that invitee stays `not_sent` while the other seven read `unopened`, and `GET .../notifications` names them. The dashboard funnel derives from those same `sent_at` rows, so it is asserted at the data layer rather than in a browser.)
- [x] Reminders ninety seconds after invitations send nothing and say why. (`apps/api/src/routes/admin/invitations.test.ts` and the CLI e2e walkthrough: `sent: 0, skipped_recent: 2, skipped_pref: 1, min_age_hours: 48` plus the `--min-age` help line; `--min-age 0` then sends, and the reminder's own timestamp refuses the next run.)
- [x] #52 and #58 closed by the PR.

## Risks / unknowns

- The `export` mailer must still mark as sent (its "send" is writing the CSV row). — Held: `ExportMailer.send` resolves normally, so the dispatcher records it like any other acceptance; the send response's CSV now mirrors only the rows the mailer actually wrote.

## Notes

- **The `invite` / `send` / `remind` bus events are gone**, along with their listener in `notifications/plugin.ts`. An endpoint that must report what the mailer accepted cannot announce an intention and walk away, so the routes call `fastify.notifications.deliver` directly — the pattern `routes/admin/versions.ts` already used for publish-triggered sends. Nothing else consumed those events.
- **`alsoSet` travels with the failure record**, so a `notifications retry` writes `sent_at` and `notified.invitation` together too. Both keep the original batch's timestamp (retry reuses `notifiedValue`, which the digest depends on), so a retried invitation's `sent_at` is the first attempt's minute, not the retry's. The two fields can never disagree about *whether* the person was reached, which is what the spec rule is about.
- **Both invitation routes turn the dispatcher's idempotency skip off** (`isAlreadyNotified: () => false`). `sent_at` — which each route filters on itself — is the authoritative record of who has been invited, and `people send --person x` is a deliberate re-send that the dispatcher's own "already notified" check would otherwise swallow.
- **Reminders mark themselves, after delivery.** The reminder number is per person, and `deliver` writes one value per batch, so the route commits the count and its `reminder-<n>` timestamp itself from `delivery.sentPeople`. One commit, only the people the mailer accepted. A reminder that fails is not recorded, which means `notifications retry` re-sends it without bumping the count — acceptable, and the alternative (per-target notified values) would complicate the dispatcher for one caller.
- **`notified.reminder` (the count) stays** beside the new `reminder-<n>` timestamps because `specs/data-model.md` specifies it and the CLI/dashboard read it. `GET .../notifications` consequently lists both `reminder` and `reminder-1` as event keys; that is the spec's event-key naming showing up honestly, not drift.
- **"Messaged" excludes `links-exported`.** It lives in `notified` but is an operator's CSV export, not mail to the person; `lib/notify.ts`'s `lastMessagedAt` skips it and ignores non-timestamp values (the numeric count). The digest's date-only value (`"2026-09-21"`) reads as that date's midnight UTC, which is close enough for a 48-hour interval.
- **A person whose invitation was rejected is `not_sent`, so `remind --target unopened` leaves them alone.** That is right — you cannot remind someone you never reached; `people send` is the command for them, and it now tells the operator so.

## Follow-ups

None.
