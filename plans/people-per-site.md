---
status: done
depends: []
specs:
  - specs/data-model.md
  - specs/behaviors/sites.md
  - specs/behaviors/signatures.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/api/participant.md
  - specs/screens/document.md
  - specs/screens/admin-dashboard.md
issues: [51]
pr: 110
---

# Plan: people-per-site

## Scope

Close issue #51: a `people` record is instance-wide, so an import on one
document silently rewrites another document's signer, and that document's sign
card then offers an unrelated organization and title.

Three changes together:

1. **People belong to a site.** `people` is keyed `${{ site }}/${{ id }}`; the
   email merge key and the id's uniqueness are per site; every person lookup is
   scoped by the site of the document in hand. Two sites may hold one email as
   two independent records.
2. **A per-document prefill lives on the participation.** `participations.prefill
   { name?, org?, title?, descriptor? }`, written at import from the row's
   values for that document. The participant bundle's `prefill` resolves field
   by field: participation → the person's site-level default → nothing, so an
   existing participation with no `prefill` behaves exactly as today.
3. **An import never overwrites a set field without `--update`.** Blanks are
   filled either way; the dry run says per row what it would change and what it
   would keep, in whichever mode, and the summary counts the rows that would
   replace a value that was already there.

Plus the boot-time migration of the pre-site layout, in one idempotent commit.

Out of scope: the other three defects named in #51's body — no per-row capacity
in the import, `--suggested-capacity` having no visible effect on the card's
default, and removing a person who was imported by mistake (`people remove`
already takes back a staged invitation; deleting the person record itself is
not offered). Also out: any cross-site people directory, which would be a lobby.

## Implements

- `specs/data-model.md` → `people` (the `site` field and the `${{ site }}/${{ id }}`
  path), § A person belongs to a site; a per-document prefill belongs to the
  participation (the decision write-up), § Migrating the pre-site layout, the
  `migrate` row of the `Action` trailer table, `participations.prefill`, and
  § Import from a CRM (merge within the site; `--update`).
- `specs/behaviors/sites.md` § People are per site — the scope rule, the
  scope-follows-the-document rule, and the removal of the old "out of scope
  here" bullet.
- `specs/behaviors/signatures.md` § Capacity — the sign card's prefill
  resolution order.
- `specs/api/admin.md` § People and invitations — `?update=1`, the new response
  shape (`update`, `people_overwritten`, `would_change`, `kept`), and the
  invitations list returning the document's resolved name/org/prefill.
- `specs/api/admin-cli.md` — `people import --update`, the `--help` line, the
  `people list` columns, and the output rule that a people view names its site.
- `specs/api/participant.md` / `specs/screens/document.md` — the bundle's
  `prefill` resolution.
- `specs/screens/admin-dashboard.md` — the People page shows the effective
  prefill.

## Approach

1. **Specs + this plan first, one commit.**
2. **Sheet configs.** `.gitsheets/people.toml`: `path = '${{ site }}/${{ id }}'`,
   `site` added to properties and to `required`. `.gitsheets/participations.toml`:
   an optional `prefill` object with the four string properties,
   `additionalProperties = false`. Production receives both at boot through
   `syncSheetConfigs`, which already runs before the store opens.
3. **Records.** `PersonRecordSchema` gains `site`; `ParticipationRecordSchema`
   gains `prefill`. `ACTIONS` gains `migrate`.
4. **Read model.** People are keyed `<site>/<id>`. `getPerson(site, id)` is the
   primitive; `getPersonOn(documentSlug, personId)` resolves the document's site
   and is what every call site uses, since each already holds a document slug.
   `refreshPeople()` for the migration, and `applyCommit` reloads people on
   `migrate`.
5. **Migration** (`storage/people-site-migration.ts`), called from
   `storage/plugin.ts` beside `ensureBootstrapSuperadmin`. `git ls-tree HEAD:people`
   finds blobs directly under `people/`; each is parsed with `Bun.TOML.parse` and,
   in one `commit("migrate", { actor: system })`, upserted as
   `{ ...record, site: 'default' }` and deleted from the old path
   (`sheet.delete('<id>')` takes a root-relative path and is what reaches a record
   the current template can no longer render). No old layout → no commit.
6. **Import** (`routes/admin/invitations.ts`). The plan pass and the write pass
   share one `planRow()` so a dry run and the real import can't drift: resolve
   the person within the document's site, compute `would_change` / `kept` for the
   mode, and build the participation's `prefill` from the row. The write pass
   patches only the fields the plan named.
7. **Resolution helper** (`lib/prefill.ts`): `resolvePrefill(person, participation)`
   → `{ name, org, role, descriptor }`, used by the participant bundle and by the
   invitations list so the sign card, "view as" and the People table agree.
8. **CLI**: `--update` flag, `would_change` / `kept` columns, the site line, the
   help text; rebuild the skill bundle.

## Validation

- [x] Two sites, one email: importing the same address on a document of each
      site creates two person records with independent fields, and neither
      import touches the other's record.
- [x] Prefill resolves field by field: participation `prefill` wins, the person's
      default fills the rest, a field neither supplies is absent; a participation
      with no `prefill` resolves exactly as before.
- [x] Import without `--update` fills an existing person's blanks and keeps their
      set fields; with `--update` the row's values replace them and an existing
      participation's `prefill` is refreshed.
- [x] Dry run reports `would_change` and `kept` accurately in both modes, and
      writes nothing.
- [x] The boot migration moves pre-site records to `people/default/<id>.toml`
      with `site = 'default'` in one `Action: migrate` commit, and a second run
      makes no commit at all.
- [x] The participant bundle exposes no `people` field beyond the resolved
      prefill and the person's id and name.
- [x] A person is resolved through the document's site, not the caller's: a
      superadmin reading a document on site A sees site A's person even when the
      same email exists on the default site.
- [x] `bun run lint`, `format:check`, `typecheck` and `bun test` green in every
      touched package; the CLI bundle drift gate green.

## Risks / unknowns

- **The path template cannot fall back.** `${{ site || "default" }}` renders as
  un-renderable when the field is absent (verified against gitsheets 2.6.0), so
  `site` has to be a real field on every record and the migration has to rewrite
  content, not just move files.
- **The migration reads the git tree, not the working copy.** gitsheets writes
  land in the ref and leave the working tree stale, so anything that reads the
  old layout off disk would be wrong on a warm data directory.
- **Person ids are no longer instance-unique**, so any lookup by bare id is now a
  latent cross-site read. The read model's primitive takes a site for that
  reason, and no call site is left able to ask without one.

## Notes

- **The path template cannot fall back, and that is what forced a real
  migration.** `${{ site || "default" }}` renders as un-renderable when the
  field is absent (gitsheets 2.6.0, verified against a scratch repo), so a
  record without `site` cannot be written or read at all. The pre-site
  records therefore had to be *rewritten* with the field, not moved — which
  in turn is why the migration parses the old blobs itself.
- **`sheet.delete` takes a root-relative path, without the extension.**
  `delete('jane-doe')` removes `people/jane-doe.toml`; `delete('people/jane-doe')`
  and `delete('jane-doe.toml')` both raise `record_not_found`. That one call
  is the only way to reach a record the current template can no longer
  render, and it is what lets the whole migration be one gitsheets commit
  rather than a plain-git file move plus a fix-up commit.
- **The migration reads the git tree, never the working copy.** gitsheets
  writes land in the branch ref and leave checked-out files stale, so a warm
  data directory's `people/` on disk is not what the store is reading.
- **`site` on a person is required; `site` on a document is not.** They look
  like the same field and are not: a document's site is a plain field that
  reads as `default` when absent, but a person's is a path component, so
  absence is unrepresentable. That asymmetry is the reason this is the first
  change in the sites arc to need a migration at all.
- **Three names for one fact, deliberately.** The import row and the person
  record call it `role`, the participation's prefill calls it `title`
  (because it prefills `signature.title`), and the bundle keeps `role` on the
  wire. `lib/prefill.ts` is the single place the mapping lives, and
  `data-model.md` states it so nobody re-derives it.
- **`people_updated` changed meaning.** It used to count every row that
  matched an existing person; it now counts rows that actually change a
  person field, so a re-import of an unchanged list reports 0. Two existing
  tests asserted the old number and were updated rather than worked around.
- **The admin People screen needed no React change.** The invitations list
  now returns the document's *resolved* name and org, so the existing table
  renders the effective prefill without touching a component. The `org`
  column the dashboard spec has always listed is still not rendered by the
  web table — pre-existing drift, untouched here.

## Follow-ups

- **Issue [#51](https://github.com/JarvusInnovations/signatories/issues/51) names three more defects this plan did not take:** no per-row capacity
  in the import, `--suggested-capacity` having no visible effect on the
  card's default, and no way to delete a person imported by mistake
  (`people remove` takes back a staged invitation; the person record stays).
  They are independent of the tenancy decision and want their own plan.
- **Tracked as spec drift:** `specs/screens/admin-dashboard.md` § People
  lists an `org` column the web table does not render. The API now returns
  the value, so closing this is a one-column change whenever the People
  screen is next opened.
