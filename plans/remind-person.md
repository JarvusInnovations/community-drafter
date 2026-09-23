---
status: done
pr: 120
depends: [notification-matrix]
specs:
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/behaviors/notifications.md
---

# Plan: remind-person

## Scope

**In:** `people remind --person a,b` and `person: [..]` on `POST /documents/:slug/invitations/remind`:
limit a reminder run to named people. `--target` stays required and still applies, as do
`--min-age` and the `reminders` preference; with `person` given, every skip names the
person and why (not in the target segment, link revoked, messaged too recently,
reminders off). A slug with no invitation on the document is a 422 naming it. `--dry-run`
works with it.

**Out:** naming skipped people on an un-filtered remind run (counts only, as today); any
change to `people send`'s handling of unknown slugs; any change to how the skill's CLI is
installed or invoked (it stays `scripts/signatories-axi` from the skill directory, not a
`PATH` tool — owner decision).

## Implements

- `specs/api/admin.md` — the `person` field on remind, the named `skipped` list, the 422.
- `specs/api/admin-cli.md` — `--person` on `people remind`.
- `specs/behaviors/notifications.md` § Sending — a named reminder still honours the segment,
  the interval and the preference.

## Approach

API: validate `person` (array of strings; every slug must have a participation on this
document, else `validation_failed` with `field: "person"` and the unknown slugs). Filter the
document's participations to the named set, then apply the existing revoked / segment /
preference / recency rules, recording a `{ person, reason }` for each skip when `person` was
given (`not_in_target`, `link_revoked`, `recently_messaged`, `reminders_off`). The
`skipped_recent` and `skipped_pref` counts keep their meaning.

CLI: parse `--person` with the same `csv()` helper as `send`, render the `skipped` list as
`send` does.

## Validation

- [x] API test: `person` limits the reminder to the named people.
- [x] API test: a named person outside the target segment is skipped as not in segment, named.
- [x] API test: an unknown slug is a 422 naming it.
- [x] API test: `dry_run` with `person` sends nothing and names the skips.
- [x] CLI e2e: `people remind --person` reaches only the named person.
- [x] Bundle and SKILL.md rebuilt; drift gate passes.
- [x] Lint, format:check, typecheck and tests pass in `apps/api` and `packages/cli`.

## Risks / unknowns

None significant.

## Notes

The brief originally included a second item: a symlink-resolving skill shim so the CLI could
sit on a person's `PATH`. The owner dropped it before any code was written. The CLI is
deliberately a skill invoked as `scripts/signatories-axi`, not a `PATH` tool. Skip reasons are
`not_in_target`, `link_revoked`, `recently_messaged` and `reminders_off`. A revoked link used
to drop out of a remind run silently and still does on an un-named run, but a named run now
reports it. Unlike `people send`, which ignores an unknown `--person`, remind refuses one.

## Follow-ups

None.
