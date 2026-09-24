---
status: done
depends: []
issues: [6, 21, 78, 8]
pr: 90
specs:
  - specs/behaviors/versioning.md
  - specs/screens/admin-dashboard.md
  - specs/api/admin.md
  - specs/api/conventions.md
  - specs/architecture.md
---

# Plan: read-model-and-errors

## Scope

Four small, independent corrections that share no code but do share a shape: each is a
place where the running service tells a thinner truth than its spec.

- **#6** — the version scan only looks at commits the service itself made. A body change
  pushed by hand or with `gitsheets-axi` is not counted, though
  `specs/behaviors/versioning.md` says any body change is a version.
- **#21** — an `extend`/`reopen` commit names *which* deadlines moved but not what they
  moved from and to, so the dashboard's activity feed cannot show old and new times even
  though the schedule-changed email already can (PR #80).
- **#78** — a body Fastify itself refuses to parse (`FST_ERR_CTP_EMPTY_JSON_BODY` and
  friends) is reported as a 500 `internal_error` rather than the 400 `invalid_request`
  `specs/api/conventions.md` requires.
- **#8** — nothing gates `tf/` on a pull request; infra typos surface at apply time, on a
  release.

Out of scope: any other error-handler behavior (5xx handling, logging shape) beyond
carrying a framework 4xx through; any change to how the schedule-changed *email* is
composed (already correct); `tofu apply` from a PR (never — see Approach); a read-only
service account of its own for the plan job (deferred, see Follow-ups).

## Implements

- `specs/behaviors/versioning.md` § Any body change is a version — the version scan runs
  over every commit that changed the document's record file, not only commits carrying
  this service's `Action`/`Document` trailers.
- `specs/screens/admin-dashboard.md` § Recent activity — an `extend`/`reopen` entry shows
  the deadlines it moved with their literal old and new times.
- `specs/api/admin.md` § Activity — the entry shape gains `deadlines`, parsed from the
  commit's `Deadlines` trailer.
- `specs/api/conventions.md` § Responses — a framework-raised error that already carries a
  4xx status keeps that status and reports the matching `error` value; `internal_error` is
  reserved for 5xx.
- `specs/architecture.md` § Deployment — a pull request touching `tf/` is gated in CI.

## Approach

1. **#6 (read model).** `logWithTrailers` gains each commit's changed paths (one extra
   `--name-only` on the existing single `git log` pass; a distinct record separator keeps
   the path block unambiguous next to the trailer block). `computeDocumentEntry` treats a
   commit as this document's when its `Document` trailer matches **or** its changed paths
   contain `documents/<slug>.md`, and admits a commit to the version scan when its action
   is document-mutating **or** it touched that path. The existing
   `body === previousBody` check then does the real work, so a settings-only hand edit
   still is not a version.
2. **#21 (deadlines in activity).** Add a `Deadlines` trailer (`CommitInput.deadlines`)
   carrying `<field> <from|-> -> <to>` pairs, set by `/schedule` and `/reopen` from the
   `DeadlineChange[]` they already compute for the `schedule-changed` event. The activity
   route parses it back into `deadlines: [{ deadline, from, to }]`; the dashboard renders
   "Comments close moved from … to …" in the operator's locale under the subject line.
3. **#78 (error handler).** In `app.ts`, before the `internal_error` fallback, map an
   error carrying a 4xx `statusCode` onto the conventions table's value for that status
   (400 `invalid_request`, 401 `unauthenticated`, 403 `forbidden`, 404 `not_found`,
   413 `payload_too_large`, 415 `unsupported_media_type`, 429 `rate_limited`; any other
   4xx → `invalid_request`), keeping the framework's message and putting its `code` in
   `details`. 5xx keeps `internal_error` and the error log.
4. **#8 (CI).** Two workflows, split on the credential line that `ci-quality-gates` draws:
   - `tf-validate.yml` — credential-free, fork-safe: `tofu fmt -check -recursive`,
     `tofu init -backend=false`, `tofu validate`. The required gate.
   - `tf-plan.yml` — the same Workload Identity auth `publish.yml` uses
     (`google-github-actions/auth`, asdf-installed opentofu), `tofu init` against the real
     `jarvus-tfstate` backend, then `tofu plan -concise -lock=false` and nothing else. Never
     `apply`, never `-out`, never an uploaded plan file. Skipped on fork PRs, which cannot
     mint an OIDC token. Variables come from the committed `tf/terraform.tfvars` (the same
     `image_tag` a release passes explicitly), so the plan reads against the deployed tag.
     **Amended mid-plan:** CI has no read access to `jarvus-tfstate`, so this half was
     withdrawn — see Notes and issue #92.

## Validation

- [x] A commit that changes `documents/<slug>.md` with no trailers at all is counted as a
      version, with its subject as the summary; a trailerless settings-only commit is not.
      `read-model.test.ts` writes both straight through `store.transact` and asserts the
      version list, the publisher (the git author) and the activity feed.
- [x] Extending a deadline records old and new times on the commit, and
      `GET /admin/api/documents/:slug/activity` returns them as `deadlines`
      (`documents.test.ts`), with the trailer's own round-trip covered in
      `packages/shared/src/records/trailers.test.ts`.
- [x] `DELETE /admin/api/documents/:slug/operators/:email` with
      `content-type: application/json` and no body returns 400 `invalid_request`, not
      `internal_error` (`app.test.ts`, which also covers a malformed JSON body). The 5xx
      branch is unchanged and still logs; no test drives it.
- [x] `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun test` pass for
      every package the change touches — api 203, web 101, shared 35, cli 44, no failures.
- [x] The `tf/` workflow parses (`actionlint` 1.7.12, clean over the whole workflow
      directory) and is scoped to `paths: [tf/**]`; it does not run `apply`. `tofu fmt
      -check -recursive`, `init -backend=false` and `validate` were also run locally
      against `tf/` and pass, and the job is green on PR #90. Only `tf-validate.yml`
      shipped: the criterion said "two workflows", and the plan half was withdrawn after
      it failed in CI — see Notes.
- [x] A `tofu plan -concise` runs on PRs that touch `tf/`. Built on PR #90, withdrawn when
      CI could not read the state bucket (#92), restored once the CI service account was
      granted object access on `gs://jarvus-tfstate` (2026-09-21); green on the restoring PR.

## Risks / unknowns

- **`--name-only` on merge commits.** `--first-parent` sets `--diff-merges=first-parent`
  on modern git, so a merge's paths are its first-parent diff. Older git would list none —
  acceptable: the data repo is single-writer and has no merges.
- **Activity feed noise.** Admitting path-touching commits also admits them to the activity
  feed with no `Action`; that is the truthful reading of "the record's own event log", and
  the dashboard renders the subject either way.
- **Plan-job credential.** The CI service account is the deploy account, not a read-only
  one. `plan` cannot write, and `-lock=false` keeps a PR from taking the state lock, but a
  narrower principal would be better (Follow-ups).
- **Fork PRs.** The plan job is skipped rather than failing red on forks; the credential-free
  validate job still runs.

## Notes

- **A trailerless commit is recognized only by its path, so the log pass had to carry
  paths.** `--name-only` rides the existing single `git log` spawn rather than costing a
  second one; the format ends with its own separator (`\x1d`) because git appends the path
  block outside the format, and the trailer block can in principle contain the field
  separator already in use.
- **Admitting path-touching commits does not make settings commits versions.** The body
  comparison that was already there does that work; the change only widens which commits
  get compared. A commit that touched the record without changing the body is still an
  activity entry and not a version.
- **The `Deadlines` trailer, not the commit diff.** The activity endpoint could have
  recomputed old and new times by diffing the commit, but that is a second reading of the
  same fact and needs a `git show` per entry in a feed that renders 50. The trailer is
  where `specs/data-model.md` puts structured facts, and the route already reads trailers.
- **`DeadlineChange` moved to `packages/shared`** next to the trailer it is written as, and
  `events/bus.ts` re-exports it, so the event and the commit cannot drift apart.
- **The extend subject changed shape**, from `extend: <slug> comments_close_at,
  signing_closes_at` to `extend: <slug> comments to <ts>, signing to <ts>` — which is what
  `specs/data-model.md`'s example subject always said it was. The dialog's success banner
  echoes the subject, so an operator sees the times twice over, in the banner and in the
  feed.
- **The `tofu plan` gate does not exist yet, and the reason is worth knowing.** It was
  written, pushed, and failed on PR #90 at `tofu init`: `community-drafter-ci@…` has no
  `storage.objects.list` on `jarvus-tfstate`, a bucket outside this project that this
  repo's `tf/` does not manage. The workflow was withdrawn rather than left failing red on
  every infrastructure PR. **The same 403 sits in front of `publish.yml`'s deploy job**,
  which runs `tofu init` under that same account — and that workflow has never run, so
  nobody has hit it; every deploy so far has been a manual `tofu apply` from a workstation.
  Issue #92 carries both, along with the argument for a reader principal rather than the
  deploy account.
- **`specs/architecture.md` records the gap** rather than claiming the plan gate exists:
  the credential-free half is required now, the plan half "runs as soon as CI holds a
  principal that can read the state bucket".
- **415 is mapped but not exercised.** An admin route inherits a `text/plain` parser from a
  sibling plugin, so the obvious 415 case parses instead of failing; the mapping stands for
  a request that does reach Fastify's media-type check.

## Follow-ups

- Issue [#92](https://github.com/JarvusInnovations/community-drafter/issues/92) — grant a
  CI principal read on `jarvus-tfstate` (preferably a reader service account of its own,
  not the deploy account), restore `tf-plan.yml` from this PR's history, and confirm the
  release deploy job can `init` at all. Carries the withdrawn half of #8.
- **Tracked as:** `tf-validate.yml` ran green on PR #90 because the PR edits the workflow
  itself; the first PR that actually changes `tf/**` is the real first exercise of the path
  filter. Watch that run rather than assuming the gate is live.
