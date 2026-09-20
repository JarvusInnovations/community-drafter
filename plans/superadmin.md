---
status: in-progress
depends: []
specs:
  - specs/behaviors/operators.md
  - specs/data-model.md
  - specs/api/admin.md
  - specs/api/auth.md
  - specs/api/admin-cli.md
  - specs/screens/admin-dashboard.md
---

# Plan: superadmin

## Scope

A `superadmin` flag on the operator record that lets its holder see every document in the dashboard and CLI and pass document scoping everywhere, while every action stays attributed to their own email. Grantable only by a superadmin (never on oneself) or by editing the data repo; the bootstrap operator is seeded with it at boot. Also lands the boot-time sheet-config sync from issue #27, without which a new optional field cannot be written to an existing data repo.

## Implements

- `specs/behaviors/operators.md` — § Superadmins.
- `specs/data-model.md` — `operators.superadmin`.
- `specs/api/admin.md` — scoping exception, `GET /documents`, `GET/PATCH /operators`.
- `specs/api/auth.md` — `GET /auth/session` shape.
- `specs/api/admin-cli.md` — `operators update --superadmin`.
- `specs/screens/admin-dashboard.md` — the pill and the document-list line.

## Approach

1. Shared schema and `.gitsheets/operators.toml` gain the optional boolean; `syncSheetConfigs` at boot writes and commits any changed sheet config into the data repo (issue #27).
2. Gateway: the operator principal carries `superadmin` (re-read per request); `enforceDocumentScope` passes superadmins; the document list skips its filter for them.
3. `PATCH /operators/:email` accepts `superadmin` from superadmins only (403 otherwise; 422 on oneself); views and the session include it; `ensureBootstrapSuperadmin` seeds the bootstrap operator.
4. CLI `operators update --superadmin true|false`, list column; web: pill on the operators page, note on the document list.
5. Tests: gateway scope bypass, list-all, PATCH permission matrix, bootstrap seeding, sheet-config sync.

## Validation

- [ ] A non-superadmin still gets 404 on a document they are not on; a superadmin gets 200 and sees every document in `GET /documents`.
- [ ] `PATCH /operators/:email { superadmin }` is 403 for non-superadmins, 422 on oneself, 200 for a superadmin on another.
- [ ] Boot on a data repo with a stale `operators.toml` commits the updated config and then succeeds in writing the flag.
- [ ] The live instance's bootstrap operator shows the pill and sees all documents after deploy.

## Risks / unknowns

- The sheet-config sync writes to the data repo's working tree and commits with git directly; it runs before gitsheets opens the repo, so nothing holds the lock yet.

## Notes

(closeout)

## Follow-ups

(closeout)
