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

### 3. Auth secret (`AUTH_SECRET`)

One secret `tf/secrets.tf` references but doesn't create:

```sh
gcloud secrets create community-drafter-cookie-secret --project=community-drafter \
  --replication-policy=automatic
openssl rand -base64 48 | gcloud secrets versions add community-drafter-cookie-secret \
  --project=community-drafter --data-file=-
```

(The secret keeps its pre-`operators-auth` name — `community-drafter-cookie-secret`
— but is wired to the `AUTH_SECRET` env var. `specs/behaviors/operators.md`:
it signs every operator session cookie, CLI token and magic link.)

`tf/secrets.tf` also creates `community-drafter-webhook-secret` itself, as a
managed resource with a placeholder version (`ignore_changes = [secret_data]`
so `tofu plan` never proposes reverting a real value back to the
placeholder). Set the real value once, out of band:

```sh
openssl rand -base64 48 | gcloud secrets versions add community-drafter-webhook-secret \
  --project=community-drafter --data-file=-
```

This is `DATA_REPO_WEBHOOK_SECRET` — the HMAC key `POST /admin/api/refresh`
verifies (`X-Hub-Signature-256`, GitHub's header shape) to pull a hand edit
pushed to the data repo's remote into the running instance
(`specs/behaviors/operators.md` § Data-repository refresh).

Point the data repo's own webhook at that route so a push made outside the
service (e.g. a hand edit with `gitsheets-axi`, pushed directly) is picked
up without waiting for the next request to notice a stale clone:

```sh
gh api repos/JarvusInnovations/community-drafter-data/hooks -f name=web \
  -f config[url]="$SERVICE_URL/admin/api/refresh" \
  -f config[content_type]=json \
  -f config[secret]="<the same value stored in community-drafter-webhook-secret>" \
  -F events[]=push
```

GitHub signs each delivery with `X-Hub-Signature-256` over the raw request
body using that secret — exactly what the route verifies. Use "Redeliver"
on a failed delivery (repo → Settings → Webhooks) to retry after fixing a
transient `409 refresh_busy`; a `409 refresh_diverged` means the local
clone and the remote history disagree and needs a person to look, not a
retry.

### 4. Bootstrap the first operator

There is no admin allowlist any more — operators are records in the
`operators` sheet (`specs/behaviors/operators.md`). The *only* way the first
one comes into existence is `BOOTSTRAP_OPERATOR_EMAIL`, wired from
`var.bootstrap_operator_email`:

```sh
tofu apply -concise -var bootstrap_operator_email="you@jarv.us"
```

Set only while the `operators` sheet is empty (the storage layer ignores it
otherwise). Once bootstrapped, sign in at `/admin/login` with that address —
a magic link is emailed (requires the mailer to be configured; `MAILER=export`
writes the link to the CSV instead, see below) — and manage further
operators from the dashboard or `drafter-axi operators add`.

### 5. Postmark sender (when moving off `MAILER=export`)

The instance ships with `MAILER=export` (writes a CSV of
`name,email,subject,link` for mail-merge) so no mail provider is required
to launch — though note that operator sign-in itself requires a working
mailer (`specs/behaviors/operators.md`: "an instance without one cannot sign
operators in, by design"); `MAILER=export` still works for this, since the
magic link lands in the CSV row same as any other message. To switch to
Postmark:

1. Add/verify a sender signature for `INSTANCE_FROM_EMAIL` in the Postmark
   account. **One Postmark server and one API key serve every site**; a site
   with its own `sender_email` needs its own verified signature or domain in
   that same account (step 7), and messages carry the site's slug as a
   Postmark tag so per-site statistics do not need per-site accounts.
2. Create a Postmark server API token.
3. `gcloud secrets create community-drafter-postmark-api-key ... && gcloud secrets versions add ...`
   (not yet wired into `tf/` — add a `data`/`google_secret_manager_secret`
   reference plus a `POSTMARK_API_KEY` env-from-secret block in
   `tf/cloudrun.tf`, mirroring the pattern used for `AUTH_SECRET`, and flip
   `mailer` to `"postmark"` in the tfvars.)

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
`ghs.googlehosted.com.` at last check) by hand. Additional customer hostnames
follow the same path through `var.site_hostnames`; see step 7. Certificate provisioning
finishes automatically once the record resolves; no further `tofu apply`
needed.

### 7. Onboarding a site (a customer hostname)

One deployment answers on many hostnames; each is a **site** with its own name,
sender and operator group (`specs/behaviors/sites.md`). Four steps, in this
order. Steps 1–3 are infrastructure and DNS; only step 4 is data.

**1. Verify the domain to the GCP project.** Google refuses to create a domain
mapping for a domain the project has not been verified for. Either have the
customer add the TXT record Google prints, or verify the domain yourself in
Search Console with the project's service account as an owner:

```sh
gcloud domains verify letters.example.org
```

**2. Map the hostname.** Add it to `site_hostnames` in `tf/terraform.tfvars`
and apply. `tf/cloudrun.tf` creates one `google_cloud_run_domain_mapping` per
entry alongside the deployment's own:

```sh
cd tf
tofu apply -concise
gcloud run domain-mappings describe --domain=letters.example.org \
  --project=community-drafter --region=us-east4 \
  --format='value(status.resourceRecords)'
```

The mapping is created before DNS exists; Cloud Run reports
`CertificatePending` and waits.

**3. Point DNS at the service.** The customer adds the CNAME the previous
command printed (`letters` → `ghs.googlehosted.com.` at last check) in their
own zone. The certificate provisions automatically once the record resolves —
usually minutes, occasionally longer. No further apply.

**4. Create the site record.**

```sh
drafter-axi sites create example \
  --hostname letters.example.org \
  --name "Example Letters" \
  --reply-to team@example.org \
  --sender-email letters@example.org
drafter-axi sites operators add example someone@example.org
```

`sites create` prints, in one block, every DNS record the customer still has to
add — the CNAME above, and with `--sender-email` the two Postmark records (a
DKIM `TXT` and a Return-Path `CNAME`). **Take those two values from the
Postmark UI** (Sender Signatures → the domain → DKIM / Return-Path); automating
this through Postmark's Account API is a follow-up, not something the service
does today.

Until the sender's domain is verified in Postmark, mail from that site's
documents **fails per recipient** rather than going out under the platform's
address — that is deliberate (`specs/behaviors/notifications.md` § Sending).
Leave `--sender-email` off until verification is done and the site's mail goes
out from the platform address under the site's name, which is a fine place to
start.

Assign documents with `drafter-axi docs create <slug> --site example …` or
`drafter-axi docs update <slug> --site example`. A document with no `--site`
belongs to the default site, which is this deployment's own hostname, name and
sender — nothing about existing documents changes.

**Watch the ceiling.** Cloud Run enforces a per-project limit on domain
mappings and each one is slow to provision. Check the current quota before
promising a customer a hostname, and onboard in batches rather than one apply
per signup.

### 8. Signing in: a human, the CLI, and a bot operator

**A human**, at `/admin/login`: enter the operator's email, follow the
emailed magic link. Sessions last 24 hours.

**The CLI** (`drafter-axi`), device-code style — there's no password or
long-lived secret to copy around:

```sh
drafter-axi login you@jarv.us --url https://drafts.example.org
```

This sends the same magic-link email, prints an 8-character code, and
waits. Follow the link (or have the mailbox owner follow it, for a bot —
see below), click "Approve this device" on the page it lands on, and the
CLI finishes on its own: it writes the instance URL, the operator's email
and a 90-day token to `~/.config/drafter/default.toml` (mode 600). Every
later `drafter-axi` command reads from there and refreshes the token
silently once it's more than 30 days old; `drafter-axi logout` forgets it,
`drafter-axi whoami` shows who's signed in and until when.

**A bot operator** (`kind: bot`, created with
`drafter-axi operators add bot@jarv.us --name "Release Bot" --kind bot`) has
its own mailbox but no hands to click a link with. Signing it in the first
time — and every time its 90-day token lapses without a human noticing — is
a human's job:

1. Run `drafter-axi login bot@jarv.us --url https://drafts.example.org` from
   wherever the bot's automation will read the resulting profile (its own
   machine/container, or a shared secret store the automation reads from).
2. A human with access to the bot's mailbox opens the magic-link email and
   approves the device on the page it lands on.
3. The CLI on the bot's side finishes and saves the token — the bot signs
   in under its own identity from then on, with its own `Actor` trailer on
   every commit it makes.

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
