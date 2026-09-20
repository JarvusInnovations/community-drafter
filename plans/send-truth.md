---
status: planned
depends: []
specs:
  - specs/behaviors/notifications.md
  - specs/api/admin.md
---

# Plan: send-truth

## Scope

Make the sending counts true (#52) and reminders safe (#58). Invitations are marked `sent_at` and `notified.invitation` only when the message was actually accepted by the mailer, in the same commit; a failed send stays unsent and visible in the failures list. `people remind` refuses to nudge anyone who received any message from the document within a minimum interval (default 48 hours, `--min-age`), and its summary reports what it actually sent.

## Implements

- `specs/behaviors/notifications.md` § Sending — "recorded on success" applies to invitations too; the reminder interval rule.
- `specs/api/admin.md` — `POST .../open` and `.../send` responses report `sent` and `failed` per person; `.../remind` gains `min_age_hours` and reports `sent`, `skipped_recent`, `skipped_pref`.

## Approach

1. The open and send routes stop pre-marking; they call the dispatcher with `markNotified: true` and an `alsoSet: { sent_at }` option so `sent_at` lands in the dispatcher's one success commit.
2. The funnel's SENT reads `sent_at` as before, which is now true.
3. Remind: filter by the newest `notified.*` timestamp per person against `min_age_hours`; count outcomes; the CLI prints them.
4. Tests: a mailer that fails for one recipient leaves that participation unsent and listed under failures; a second `send` picks it up; remind skips a person mailed ten minutes ago.

## Validation

- [ ] The "Samuel Park, MD" scenario replayed with a failing mailer shows SENT 7 of 8 and one failure with a reason.
- [ ] Reminders ninety seconds after invitations send nothing and say why.
- [ ] #52 and #58 closed by the PR.

## Risks / unknowns

- The `export` mailer must still mark as sent (its "send" is writing the CSV row).

## Notes

(closeout)

## Follow-ups

(closeout)
