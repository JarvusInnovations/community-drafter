---
status: done
depends: []
issues: [94, 98, 99]
pr: 103
specs:
  - specs/screens/public-and-embed.md
  - specs/api/conventions.md
  - specs/architecture.md
---

# Plan: quick-wins

## Scope

Three small, independent fixes found after the first public demo, shipped in one PR
because each is a few lines and none touches the others' code:

1. **#94** — a share preview describes the *statement*, not the changelog: the first
   sentence of the current version's text leads, the version `summary` is the fallback.
2. **#98** — `/admin/api/<unknown>` is answered with the SPA shell and 200 because it
   matches the `/admin/*` wildcard; an API path must reach the content-negotiating
   not-found handler instead. The same wildcard shadowing applies to `/i/<token>/api/*`
   and `/d/<slug>/api/*`, so the rule is stated and implemented for all three prefixes.
3. **#99** — the PR `tofu plan` gate stops authenticating as the deploy service account
   and gets its own read-only principal.

Out of scope: any change to what the deploy account holds (the release workflow keeps
it as-is); the actual `tofu apply` and the state-bucket IAM binding, both of which are
the owner's to run from a workstation (`tf/iam.tf`'s standing rule); a `pull_request`-
scoped WIF binding, which the provider's attribute mapping cannot express today (see
Approach).

## Implements

- `specs/screens/public-and-embed.md` § Share Preview — swap the description's two
  sources: first sentence of the current version's text, then the version `summary`,
  then the generic line.
- `specs/api/conventions.md` § URL scheme — an API path (`/i/:token/api/*`,
  `/d/:slug/api/*`, `/admin/api/*`) that matches no route is a 404 through the same
  content-negotiating handler as any other unrouted path; it is never answered with
  the SPA shell and a 200.
- `specs/architecture.md` § Deployment — the read-only `tofu plan` gate runs under its
  own read-only principal, not the deploy service account; only the release workflow's
  `apply` uses the deploy account.

## Approach

1. **#94** — in `apps/api/src/lib/share-preview.ts`, `resolvePreview` tries
   `firstSentence(current.body)` first and falls back to `condense(current.summary)`,
   then to `GENERIC_DESCRIPTION`. Update `firstSentence`'s doc comment (it currently
   says it is the fallback) and the two tests in
   `apps/api/src/routes/static.test.ts` that assert the old order.
2. **#98** — in `apps/api/src/routes/static.ts`, factor the not-found response
   (`setNotFoundHandler`'s body) into one function and have the SPA shell handler call
   it for any path under an API prefix, so the shell is served only for real client
   routes. Matching on the path is what keeps the three families consistent; the real
   API routes still win on their own merits (find-my-way ranks static/parametric above
   a wildcard), so only unknown API paths reach the 404.
3. **#99** — `tf/iam.tf` gains `google_service_account.github_actions_plan`
   (`community-drafter-ci-plan`), its own `google_service_account_iam_member` WIF
   binding, and viewer-level project bindings. The binding is scoped by
   `attribute.repository` because the pool provider maps only `google.subject` and
   `attribute.repository` — there is no `event_name` attribute to bind a
   `pull_request`-only principal set to, and adding one means editing the trust
   attributes of the provider the deploy account also assumes. Recorded as a follow-up
   rather than folded into this change. `.github/workflows/tf-plan.yml` points its
   `SERVICE_ACCOUNT` at the new account. `roles/storage.objectViewer` on the state
   bucket is **not** declared here: `jarvus-tfstate` lives outside this project and
   `tf/` manages none of its IAM, so `docs/operations.md` carries the one
   `gcloud storage buckets add-iam-policy-binding` the owner runs. With `-lock=false`
   (already in the workflow) `objectViewer` is enough — the plan reads the state
   object and writes no lock.

   Roles: `run.viewer`, `secretmanager.viewer`, `artifactregistry.reader`,
   `dns.reader`, `iam.workloadIdentityPoolViewer`, `browser`, plus
   `serviceusage.serviceUsageViewer`, `iam.serviceAccountViewer` and
   `iam.securityReviewer` — the last three because refreshing the
   `google_project_service`, `google_service_account` and `*_iam_member` resources
   this module declares needs `serviceusage.services.get` and `*.getIamPolicy`, which
   none of the first six grants. All read-only.

## Validation

- [x] `og:description` on a public document page is the first sentence of the current
      version's text even when that version has a `summary`; a version whose body
      yields no prose falls back to the summary, and an empty summary to the generic
      line — covered by tests in `apps/api/src/routes/static.test.ts`.
- [x] `GET /admin/api/documents/x/schedul` returns 404 with `{ error: "not_found" }`
      for a JSON client, and does not return the SPA shell with 200; the same holds
      for an unknown `/i/<token>/api/*` and `/d/<slug>/api/*` path, while every real
      admin/participant/public API route and every SPA route still answers as before.
- [x] `apps/api` gates green: `bun run lint`, `bun run format:check`,
      `bun run typecheck`, `bun test`.
- [x] `tofu fmt -check`, `tofu validate` and `tofu plan -concise -input=false` run
      clean from `tf/`, and the plan's adds are exactly the new service account, its
      WIF binding and its viewer role bindings.
- [x] The owner's steps for #99 (bucket binding + `tofu apply`) are written down in
      `docs/operations.md` and repeated in the PR body.

## Risks / unknowns

- **The plan gate goes red between merge and apply.** `tf-plan.yml` names a service
  account that does not exist until the owner applies; until then the auth step fails.
  Called out in the PR body so the apply is not a surprise.
- **A viewer role set that is one permission short 403s the refresh**, which is how
  #92 was found. Mitigated by including the three IAM/serviceusage read roles above;
  if a refresh still 403s, the failing resource names the missing read.
- **Excluding API paths from the SPA wildcard could shadow a real route** if a future
  client route is ever placed under `/admin/api/…`. Nothing does, and the URL scheme
  in `specs/api/conventions.md` reserves those prefixes for the API.

## Notes

- Gates: `bun run lint`, `bun run format:check` (143 files), `bun run typecheck` all
  clean; `bun test` 232 pass / 0 fail / 1349 assertions across 39 files. Nothing
  flaked. `tofu validate` succeeded and `tofu plan -concise -input=false -lock=false`
  reported **11 to add, 0 to change, 0 to destroy** — the new service account, its WIF
  binding and its nine viewer bindings, nothing else. `tofu apply` was not run.
- `tofu fmt -check` is clean on `iam.tf` but `-recursive` fails on `tf/terraform.tfvars`,
  misaligned by e60ba89 on `develop` before this branch existed. Left alone (that file
  is out of bounds for this work) and flagged in the PR; the fix is one `tofu fmt`.
- The share preview's fallback test needed the published body to *differ* from the
  seeded one: versions come from `git log`, so a patch that changes nothing commits
  nothing and the current version stays v1, whose summary is the create commit's
  subject. Worth knowing for any test that wants a specific current version.
- The plan account's role set is three roles wider than issue #99 listed. Refreshing
  `google_project_service` needs `serviceusage.services.get`, the two
  `google_service_account` resources need `iam.serviceAccounts.get`, and every
  `*_iam_member` needs a `getIamPolicy` — none of which the six named viewer roles
  grant, and a refresh that is one read short 403s, which is exactly how #92 surfaced.
  All three additions are read-only.
- `/i/*` and `/d/*` shadowed their own API prefixes the same way `/admin/*` did, so the
  fix and the spec rule cover all three rather than only the one #98 reported.

## Follow-ups

- Issue [#99](https://github.com/JarvusInnovations/community-drafter/issues/99) stays
  open for the owner: `cd tf && tofu apply -concise` from a workstation, then the one
  `gcloud storage buckets add-iam-policy-binding` on `gs://jarvus-tfstate`
  (`docs/operations.md` § 9). Until both run, the plan job fails at authentication.
- **A pull-request-scoped WIF binding.** The plan account is bound by
  `attribute.repository`, like the deploy account, because the pool provider maps no
  event attribute. Restricting it to `pull_request` means adding a mapping — e.g. a
  combined `attribute.repository_event = assertion.repository + ":" + assertion.event_name`
  — to the provider the deploy account also assumes, and binding the plan account to
  that principal set. Worth doing deliberately, on its own; not folded into a quick fix.
- `tf/terraform.tfvars` needs `tofu fmt`; the `tf-validate.yml` gate is red on `develop`
  until someone runs it. Not this branch's file to touch.
