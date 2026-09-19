---
status: planned
depends: [api-core]
specs:
  - specs/architecture.md
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
- [ ] `docker build` succeeds and the container boots against a test data repo, clones it, and answers `/_health`.
- [ ] `tofu plan -concise` is clean after apply; the service shows `max_instance_count = 1` and `min_instance_count = 1`.
- [ ] Sending SIGTERM to the container flushes pending open tracking (one `Action: track` commit appears) and the push daemon drains before exit.
- [ ] A GitHub release triggers the publish workflow, which deploys the tagged image (verified by the instance's `/whoami` reporting the version).
- [ ] The runbook has been followed once end to end by someone other than its author.

## Risks / unknowns
- **`BOT_GITHUB_TOKEN`** — release-publish needs the org-level bot token; confirm it exists before the first release.
- **Cloud Run cold restarts** — with `min_instance_count = 1` restarts still happen on deploy; the boot clone must finish within the startup probe window (set generously, and measure).

## Notes
(closeout)

## Follow-ups
(closeout)
