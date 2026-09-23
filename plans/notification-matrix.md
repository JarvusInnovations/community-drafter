---
status: in-progress
depends: [quiet-declines]
issues: [115]
specs:
  - specs/principles.md
  - specs/behaviors/notifications.md
  - specs/behaviors/signatures.md
  - specs/behaviors/document-lifecycle.md
  - specs/behaviors/versioning.md
  - specs/screens/document.md
  - specs/screens/preferences.md
  - specs/screens/admin-dashboard.md
  - specs/screens/version-history.md
  - specs/screens/deliverable.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/api/participant.md
  - specs/data-model.md
---

# Plan: notification-matrix

## Scope

The owner's review of who gets email (2026-09-23) replaced the message catalogue with a
matrix built on two principles: **every email asks something of its reader** (except
the signing receipt and `delivered`), and **operators speak; state changes don't** (no
message is a side effect of a phase change, a schedule change or a publish; the only
automatic mail is a receipt for the person's own action).

**In:**

1. Principles: the two new ones in `principles.md`, "Just sign it for now" re-promised
   ("asked once to confirm before it is delivered"), "Essentials always" rewritten
   around the new set.
2. The catalogue in `behaviors/notifications.md` becomes the matrix (message ·
   triggered by · reaches · why they care · what they can do), with the segments U, O,
   S, S-behind, C, D, Op defined once. "What a participant hears, start to finish" is
   rewritten to match.
3. **Removed:** `v<n>`, `digest-<date>`, `signing-opened`, `closing-soon`, `closed`,
   `final-published`, `operator-first-comment`; the closing-soon scheduler and its
   quiet period; the participant digest; the `every_revision`, `daily_digest` and
   `phase_changes` preferences; forced preferences.
4. **Removed: `final` versions.** No `--final`, no `final` on the version API/CLI, no
   "final text" labels, no `signed_final_pending` card state. The deliverable goes
   clean when signing closes or when the document is delivered, whichever first.
   Stored `Final: true` trailers and `final` fields are ignored, never rewritten.
5. **Now operator-triggered only:** `schedule-changed` (`docs extend|reopen --notify`,
   reaching O, counted before sending, keyed per change) and `disposition-v<n>`
   (`versions publish --notify-commenters`, reaching the authors this publish
   answered, decliners included). Without the flag each command sends nothing and
   says how many it would have reached.
6. **Reminders** carry the deadline and the ask ("Signing closes … Sign or decline.");
   the dashboard hints at `people remind` when a deadline is within 48 hours and
   people are still unopened or undecided.
7. **Receipts** name their action: the signing receipt carries "What happens next"
   (the confirm-call promise, the delivery promise, the remove-by date); a submission
   that also signed sends one combined signing receipt; a comment receipt names when
   comments close; a decline receipt names when signing closes.
8. **New `confirm-call`** (`docs confirm-call <slug> [--by] [--dry-run]`,
   `POST …/confirm-call`): reaches S-behind and C, once per person per call, commit
   `Action: confirm-call`. The card's re-affirmation ("Keep my name" / "Confirm my
   signature") clears drift and the conditional flag.
9. **New `delivered`** (`docs delivered <slug> [--note] [--dry-run]`,
   `POST …/delivered`): writes `delivered_at` / `delivered_note` (commit
   `Action: deliver`), 409 `already_delivered` on a second call, mails every current
   signer. "Delivered <date>" on the participant card, the dashboard and the public
   view.
10. Operator digest gains signing closed, confirm-calls sent and deliveries, and runs
    for a document on the day its signing closed.

**Out:** changing who a reminder targets (unchanged: `unopened`, `opened`), SMS, a
dashboard button for confirm-call or delivered (CLI only, the dashboard shows the
command).

## Implements

- `specs/principles.md` — § Every email asks something of its reader; § Operators
  speak; state changes don't; § Just sign it for now; § Essentials always.
- `specs/behaviors/notifications.md` — the whole catalogue, Defaults, Content rules,
  Sending, Operator digest.
- `specs/behaviors/signatures.md` — sign-card promise, re-affirmation, conditional
  signatures, delivery.
- `specs/behaviors/document-lifecycle.md` — extension/reopen announce only on
  request; closing sends nothing; delivery.
- `specs/behaviors/versioning.md` — no `final` flag.
- `specs/screens/document.md`, `preferences.md`, `admin-dashboard.md`,
  `version-history.md`, `deliverable.md`, `public-and-embed.md`.
- `specs/api/admin.md`, `admin-cli.md`, `participant.md`, `specs/data-model.md`.

## Approach

1. Specs first (`docs(specs)` commits), then this plan's code.
2. API
   - `lib/notify.ts`: prefs down to `reminders` + `my_comments_addressed`; segment
     predicates (`isOpenedUndecided`, `needsConfirmation`) shared by the routes.
   - Remove `closing-soon.ts`, the participant half of `digest.ts`, the
     signing-opened/closed listeners, `v<n>`/`final-published` sends and templates.
   - `routes/admin/versions.ts`: `notify_commenters` flag; response
     `notified: { commenters: { would, sent, failed } }`; `final` dropped.
   - `routes/admin/documents.ts`: `notify` + `dry_run` on schedule and reopen; new
     `confirm-call` and `delivered` routes; `documentSummary` carries `delivered_at`,
     `delivered_note`, `undecided` and `needs_confirmation` counts.
   - Receipts: combined signing receipt on a signing submission; comment/decline
     receipts name their action.
   - Deliverable clean rule; operator digest lines; `first_comment` dropped.
   - `.gitsheets/documents.toml` gains optional `delivered_at`, `delivered_note`;
     shared trailer enum gains `confirm-call`, `deliver`.
3. Web: card states (no final; conditional/behind re-affirmation; delivered line),
   prefs route (two toggles), version history (no badge), dashboard (delivered,
   confirm-call and remind hints), extend dialog (notify checkbox with count), public
   view (delivered line).
4. CLI: `docs extend|reopen --notify [--dry-run]`, `docs confirm-call`,
   `docs delivered`, `versions publish --notify-commenters`, `--final` removed; SKILL.md
   § What participants are emailed; rebuild the bundle last.

## Validation

- [ ] One test per matrix row proving exactly who receives it: invitation, signing
      receipt, revocation receipt, listing-changed, review receipt (comment, decline,
      combined-with-signature), reminder, schedule-changed, disposition, confirm-call,
      delivered.
- [ ] Nothing is sent by: signing opening, signing closing (clock or `docs close`),
      an extend or reopen without `notify`, a publish without `notify_commenters`.
- [ ] `schedule-changed` reaches O only (not U, S, D), reports its count on dry run
      and on the real call, and a second `--notify` on a later change reaches the same
      people again.
- [ ] `disposition-v<n>` reaches answered authors in O/S/S-behind/C/D and nobody
      else; publish reports would/sent either way.
- [ ] `confirm-call` dry run lists S-behind and C only; the real call mails them once
      per call and commits `Action: confirm-call`; nobody qualifying sends nothing and
      says so; "Keep my name" clears drift and conditional.
- [ ] `delivered` writes `delivered_at`, mails every current signer once, 409
      `already_delivered` on a second call; refused before signing opens.
- [ ] The signing receipt's "What happens next" names the confirm-call and delivery
      promises before delivery and omits them after.
- [ ] The deliverable is clean after signing closes or after delivery, draft before.
- [ ] `final` gone from the API, CLI and UI; a stored `Final: true` version reads fine.
- [ ] Prefs: only `reminders` and `my_comments_addressed`; stop-optional turns both off.
- [ ] Gates: lint, format:check, typecheck, tests in `apps/api`, `apps/web`,
      `packages/cli`, `packages/shared`; web build + `check:bundle-size`; CLI bundle
      rebuilt and drift gate clean.

## Risks / unknowns

- **A live document.** Existing participations carry `every_revision`,
  `daily_digest`, `phase_changes` and `notified` keys for removed events. The sheet
  schema keeps the old preference keys as optional so writes to those records still
  validate; nothing reads them.
- **Promises in flight.** Signers on the live document were told "we'll email you when
  the final version is published". The confirm-call replaces that promise; the team
  must run it (and `delivered`) for the new promise to hold.

## Notes

## Follow-ups
