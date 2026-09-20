# Operations runbook

This is the operator runbook for the single production instance
(`specs/architecture.md` § Deployment). It covers the one-time setup steps
that precede `tofu apply`, the first-boot data step, and how to deploy
manually or via a GitHub release.

## One-time setup

### 1. Create the private data repo

The data repo is out of scope for `tf/` — it's a plain GitHub repo, created
once, that then holds the gitsheets records as its only content.

```sh
gh repo create JarvusInnovations/community-drafter-data --private \
  --description "Private data repository for the Community Drafter instance (gitsheets records)"
```

Leave it empty. The Cloud Run service's boot-time clone (via the storage
plugin) expects `DATA_REPO_BRANCH` (`main`) to exist with at least one
commit — see "First boot: init-data-repo" below for how that first commit
gets made.

### 2. Deploy key

Generate an ed25519 keypair and give the data repo write access via the
private half; keep the public half as a deploy key on the repo:

```sh
ssh-keygen -t ed25519 -f ./community-drafter-deploy-key -N "" -C "community-drafter"
gh repo deploy-key add ./community-drafter-deploy-key.pub \
  --repo JarvusInnovations/community-drafter-data \
  --title "community-drafter Cloud Run" --allow-write
```

Store the private half in Secret Manager (`tf/secrets.tf` references this
by name — it does not create it, so this step must happen before the first
`tofu apply`):

```sh
gcloud secrets create community-drafter-deploy-key --project=community-drafter \
  --replication-policy=automatic
gcloud secrets versions add community-drafter-deploy-key --project=community-drafter \
  --data-file=./community-drafter-deploy-key
```

Delete the local private-key file once it's in Secret Manager. Rotate by
adding a new secret version and a matching new deploy key on GitHub; Cloud
Run always mounts `version = "latest"`.

### 3. Admin token + cookie secret

Two more secrets `tf/secrets.tf` references but doesn't create:

```sh
gcloud secrets create community-drafter-admin-token --project=community-drafter \
  --replication-policy=automatic
openssl rand -base64 48 | gcloud secrets versions add community-drafter-admin-token \
  --project=community-drafter --data-file=-

gcloud secrets create community-drafter-cookie-secret --project=community-drafter \
  --replication-policy=automatic
openssl rand -base64 48 | gcloud secrets versions add community-drafter-cookie-secret \
  --project=community-drafter --data-file=-
```

`ADMIN_TOKEN` is the bearer credential the admin CLI (`drafter-axi`) uses
against the admin API. `COOKIE_SECRET` signs the admin session cookie once
Google OAuth is configured (see below) — until then it's provisioned but
effectively unused.

### 4. Postmark sender (when moving off `MAILER=export`)

The instance ships with `MAILER=export` (writes a CSV of
`name,email,subject,link` for mail-merge) so no mail provider is required
to launch. To switch to Postmark:

1. Add/verify a sender signature for `INSTANCE_FROM_EMAIL` in the Postmark
   account.
2. Create a Postmark server API token.
3. `gcloud secrets create community-drafter-postmark-api-key ... && gcloud secrets versions add ...`
   (not yet wired into `tf/` — add a `data`/`google_secret_manager_secret`
   reference plus a `POSTMARK_API_KEY` env-from-secret block in
   `tf/cloudrun.tf`, mirroring the pattern used for `ADMIN_TOKEN`, and flip
   `mailer` to `"postmark"` in the tfvars.)

### 5. Google OAuth client (optional — for human admin sessions)

Admin auth works via `ADMIN_TOKEN` alone; OAuth is only needed for the
human-facing admin dashboard session flow. `tf/` treats it as fully
optional (`var.google_client_id` / `var.google_client_secret` default to
`null`, and the OAuth secrets + env wiring are skipped entirely until both
are set):

1. In the Google Cloud Console (a project with the OAuth consent screen
   configured — can be this project or a shared one), create an OAuth 2.0
   Web application client. Authorized redirect URI:
   `https://drafter.jarv.us/auth/google/callback` (or the `*.run.app` URL's
   equivalent path, until the domain mapping is live).
2. Apply with both secrets set:

   ```sh
   tofu apply -concise \
     -var google_client_id="..." \
     -var google_client_secret="..." \
     -var oauth_allowed_emails="alice@jarv.us,bob@jarv.us" \
     -var oauth_allowed_domains="jarv.us"
   ```

   This creates `community-drafter-google-client-id` /
   `-google-client-secret` in Secret Manager with the real values (not
   placeholders — the `count`-gated resources in `tf/secrets.tf` only exist
   once both vars are set, so there's no placeholder-clobber risk) and adds
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OAUTH_ALLOWED_EMAILS` /
   `OAUTH_ALLOWED_DOMAINS` to the Cloud Run service.

### 6. DNS for the domain mapping

`tf/cloudrun.tf` creates a `google_cloud_run_domain_mapping` for
`drafter.jarv.us` unconditionally (the resource itself doesn't need DNS to
exist first — Cloud Run reports `CertificatePending` and waits). Point the
DNS at it in whatever project/zone hosts `jarv.us`:

```sh
gcloud run domain-mappings describe --domain=drafter.jarv.us \
  --project=community-drafter --region=us-east4 \
  --format='value(status.resourceRecords)'
```

This is out of `tf/`'s scope (the DNS zone is a different GCP
project/registrar) — add the printed CNAME (`drafter` →
`ghs.googlehosted.com.` at last check) by hand. Certificate provisioning
finishes automatically once the record resolves; no further `tofu apply`
needed.

## First boot: `init-data-repo`

A freshly created data repo (step 1 above) has no commits, so
`DATA_REPO_BRANCH` doesn't exist yet and the storage plugin's boot clone
fails with `Remote branch main not found in upstream origin`. Before the
service can boot successfully, something has to make the first commit —
the four sheet configs (`documents.toml`, `people.toml`,
`participations.toml`, `submissions.toml`).

The `POST /init-data-repo` admin route / `init-data-repo` admin-CLI command
(`specs/api/admin.md`, `specs/api/admin-cli.md`) is the intended way to do
this once `api-core` lands — call it against the running (but
storage-degraded) instance and it writes + commits + pushes the sheet
configs in one shot.

Until that route exists, do it manually with the same helper the route
will call (`apps/api/src/storage/init.ts`'s `initDataRepo`), from a clone
made with your own GitHub write access (not the deploy key):

```sh
git clone https://github.com/JarvusInnovations/community-drafter-data.git /tmp/community-drafter-data-init
bun run -e '
  import { initDataRepo } from "./apps/api/src/storage/init.ts";
  console.log(await initDataRepo({ dataDir: "/tmp/community-drafter-data-init" }));
'
cd /tmp/community-drafter-data-init && git push origin main
rm -rf /tmp/community-drafter-data-init
```

Cloud Run's `min_instance_count = 1` singleton will retry its boot clone on
the next probe/restart and come up healthy once `main` exists.

## Deploying

### Manually (first deploy, or an out-of-band fix)

```sh
gcloud auth configure-docker us-east4-docker.pkg.dev
SHA=$(git rev-parse --short HEAD)
docker build -t us-east4-docker.pkg.dev/community-drafter/community-drafter/community-drafter:sha-$SHA .
docker push us-east4-docker.pkg.dev/community-drafter/community-drafter/community-drafter:sha-$SHA

cd tf
tofu apply -concise -var image_tag=sha-$SHA
```

### Via a GitHub release (`.github/workflows/publish.yml`)

Publishing a GitHub release (not a draft, not a prerelease if you want the
`deploy` job to run) fires the workflow: it builds and pushes the image
tagged with the release version (`vX.Y.Z` → `X.Y.Z`) and `latest`, then runs
`tofu apply -concise -var image_tag=X.Y.Z` from a GitHub Actions runner
authenticated via Workload Identity Federation (no long-lived key). See
`release-flow` for cutting the release itself.

**Manual applies:** `tf/terraform.tfvars` pins `image_tag` and `public_url`, so a bare `tofu apply -concise` (for example to change IAM) keeps the running service as it is. Update `image_tag` there on each manual deploy. The CI service account holds the template's project admin roles (issue #7, applied 2026-09-19), so the release workflow's `tofu apply` can manage secrets, the registry and IAM on its own.

## Verifying a deploy

```sh
SERVICE_URL=$(gcloud run services describe community-drafter \
  --project=community-drafter --region=us-east4 --format='value(status.url)')
curl -s "$SERVICE_URL/_health" | jq .
```

`storage.ready: true` means the boot clone succeeded and the read model
built. `storage.pushDaemon.running: true` (once a remote origin is
configured, which it always is in the deployed container) means the push
daemon started cleanly.
