---
status: done
pr: 49
depends: []
specs:
  - specs/api/admin.md
  - specs/api/conventions.md
  - specs/behaviors/notifications.md
  - specs/screens/admin-dashboard.md
---

# Plan: sim-fixes-1

## Scope

The defects every operator persona in the 2026-09-20 simulated run hit within its first half hour, fixed together so Phase 3 (participants) runs on a sound base: mail headers broken by a comma in a display name (issue #46), delivery failures invisible beyond a count, deadlines without a zone or in the past reaching the store and surfacing as 500s (#42, #43, #44), store validation errors on import surfacing as 500s (#41), the CLI home view ignoring the selected profile (#40), "Hi Rev.," greetings, and the instance root's bootstrap placeholder. Out: the operators directory's cross-tenant visibility and the people sheet's cross-document prefill, which are design changes with their own plans.

## Implements

- `specs/api/admin.md` — `POST /documents/:slug/open` deadline rules; `GET /documents/:slug/notifications` `failures`.
- `specs/api/conventions.md` — store validation → 422.
- `specs/behaviors/notifications.md` — failures logged and shown with detail.
- `specs/screens/admin-dashboard.md` — the instance root.

## Approach

1. `formatAddress` quotes display names for Postmark and SMTP.
2. The dispatcher logs each exhausted failure and exposes `failures(document)`; the route and `notifications list` show them.
3. `parseDeadline` on open, extend and reopen: zone required, stored as UTC, opening into the past refused.
4. The global error handler maps gitsheets `ValidationError` to 422 with `details.issues`.
5. `firstName` keeps honorific plus surname; the CLI's `isConfigured` takes the profile; the root page becomes a sign-in card.

## Validation

- [x] `formatAddress` unit test; `firstName` honorific cases.
- [x] Open with a zone-less deadline → 422 naming the field; with a past deadline → 422; with an offset → 200 and UTC stored.
- [ ] After deploy: `people import` with a bad record returns 422, not 500; a re-sent invitation to "Samuel Park, MD" reaches Postmark; `notifications list` shows the earlier failures; the root page shows the sign-in card.

## Risks / unknowns

- `parseDeadline` rejects zone-less input that a few operators typed today; the message tells them the two accepted forms.

## Notes

(closeout)

## Follow-ups

- Invitations are still marked `sent_at`/`notified.invitation` before delivery (`documents.ts` open, `invitations.ts` send); the funnel therefore counts a failed send as sent. Fix by marking on success (issue to file).
- Operators directory is instance-wide and editable by any operator (personas' top security finding); needs a scoping design.
- `people` records are instance-wide, so an import can overwrite another document's person fields and the sign card prefills org/title from an unrelated document; needs a data-model decision.
