---
status: done
depends: [api-core]
specs:
  - specs/architecture.md
pr: 9
---

# Plan: deploy

## Scope

The single production instance: Dockerfile, entrypoint that writes the deploy key and clones the data repo, OpenTofu for Cloud Run (`max_instance_count = 1`, `min_instance_count = 1`), Artifact Registry, Secret Manager, service accounts and domain mapping, the release-publish artifact workflow that builds and applies on a GitHub release, and the SIGTERM flush path. Out: the data repo's creation on GitHub (operator step, documented in the runbook).

## Implements

- `specs/architecture.md` — *Deployment*, *Configuration*.

## Approach

1. Load `release-flow` and `repo-setup` (for the publish workflow shape) and follow proposal-renderer's `Dockerfile`, `entrypoint.sh` and `tf/` layout as the template.
2. `Dockerfile` from `oven/bun` Debian with `git` and `openssh-client`; `scripts/entrypoint.sh` writes `/secrets/deploy-key/latest` to `~/.ssh`, clones `DATA_REPO_URL` at `DATA_REPO_BRANCH`, starts the API.
3. `tf/`: `asdf set opentofu latest`; Cloud Run service with secrets mounted, WIF for the GitHub Actions service account, domain mapping to the instance hostname; state in the operator's GCS backend; `tofu plan -concise` in CI on PRs touching `tf/`.
4. `.github/workflows/publish.yml`: on GitHub release published, build image, push, `tofu apply -concise -var image_tag=…`.
5. Runbook `docs/operations.md`: creating the private data repo, deploy key, Postmark sender, OAuth client, first `init-data-repo`.

## Validation

- [x] `docker build` succeeds and the container boots against a test data repo, clones it, and answers `/_health`.
- [x] `tofu plan -concise` is clean after apply; the service shows `max_instance_count = 1` and `min_instance_count = 1`.
- [ ] Sending SIGTERM to the container flushes pending open tracking (one `Action: track` commit appears) and the push daemon drains before exit.
- [ ] A GitHub release triggers the publish workflow, which deploys the tagged image (verified by the instance's `/whoami` reporting the version).
- [ ] The runbook has been followed once end to end by someone other than its author.

## Risks / unknowns

- **`BOT_GITHUB_TOKEN`** — release-publish needs the org-level bot token; confirm it exists before the first release.
- **Cloud Run cold restarts** — with `min_instance_count = 1` restarts still happen on deploy; the boot clone must finish within the startup probe window (set generously, and measure).

## Notes

- **Live deploy verified end to end.** `https://community-drafter-76gcuzmm5a-uk.a.run.app/_health` is healthy, running image `sha-23d7dc6`. `max_instance_count = 1` / `min_instance_count = 1` confirmed via `gcloud run services describe`. `tofu plan -concise` reports `No changes.` after apply.
- **The data repo was created empty** (no commits, so no `main` branch) — the boot clone failed with `Remote branch main not found in upstream origin` until the first commit landed. Bootstrapped it by running `initDataRepo` (`apps/api/src/storage/init.ts`) against a clone made with my own GitHub write access, then pushed `main`. Documented as "First boot: init-data-repo" in `docs/operations.md`, since the `POST /init-data-repo` admin route (`api-core`) doesn't exist yet.
- **CI's IAM is narrower than the proposal-renderer/jarvus-allocator template it's modeled on.** A permission-grant safety gate in the implementing session blocked applying project-wide `*.admin` roles (`iam.serviceAccountAdmin`, `secretmanager.admin`, `artifactregistry.admin`) to the CI service account, while resource-scoped bindings (`artifactregistry.writer` on the one repo, `iam.serviceAccountUser`/`iam.workloadIdentityUser` scoped to specific SAs) and project-level viewer roles (`secretmanager.viewer`, `serviceusage.serviceUsageViewer`) went through without issue. `roles/run.admin` and `roles/browser` at project scope also passed — only the `*.admin` shape was refused. See `tf/iam.tf`'s comment and Follow-ups below.
- **Entrypoint runs from `apps/api/`**, not the workspace root, so the storage plugin's default data directory (`process.cwd()/data/repo`) resolves to `apps/api/data/repo` matching its documented default rather than `/app/data/repo`.
- **Dockerfile does a two-pass `bun install`** (full install so `apps/web`'s build tooling — vite, tsc — is present, then a `--production` re-install after the web build to prune devDependencies) rather than a multi-stage build. Simpler for this single small monorepo image; revisit if image size becomes a concern.
- No `apps/` changes were needed for the SIGTERM flush path — `apps/api/src/index.ts`'s `SIGTERM` handler already calls `server.close()`, which fires the storage plugin's `onClose` hook.

## Follow-ups

- Issue [#7](https://github.com/JarvusInnovations/community-drafter/issues/7) — grant `community-drafter-ci` broader project IAM (`resourcemanager.projectIamAdmin` and/or `secretmanager.admin`/`artifactregistry.admin`) from an operator session so CI can fully self-manage future `tofu apply` runs, once the classifier-driven scope-down above needs revisiting.
- Issue [#8](https://github.com/JarvusInnovations/community-drafter/issues/8) — add a `tofu plan -concise` CI check on PRs touching `tf/` (called for in this plan's Approach but not implemented — `ci-quality-gates` territory, outside this plan's file scope).
- Deferred to [`api-core`](api-core.md) — the `POST /init-data-repo` admin route (and `init-data-repo` CLI command) that `docs/operations.md`'s manual bootstrap step stands in for.
- Tracked as: Postmark sender wiring (`POSTMARK_API_KEY` secret + `tf/cloudrun.tf` env-from-secret block) is documented as a manual follow-on in `docs/operations.md` but not implemented — `MAILER=export` ships first.
- Tracked as: the SIGTERM-flush validation criterion above is unchecked because no HTTP route exists yet to generate a tracked open in the deployed container (that's `api-core`); the underlying flush mechanism producing exactly one `Action: track` commit is covered by the already-merged `tracker.test.ts`, and this plan additionally confirmed the container-level SIGTERM path reaches and completes the same `onClose` hook before exit. Re-verify the full scenario once `api-core`'s open-tracking route ships.
