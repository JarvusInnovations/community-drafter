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
  --description "Private data repository for the Signatories instance (gitsheets records)"
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
operators from the dashboard or `signatories-axi operators add`.

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
follow the same path through `var.site_hostnames`, except that customers are
given the `sites.signatories.org` alias rather than Google's hostname; see
step 7. Certificate provisioning
finishes automatically once the record resolves; no further `tofu apply`
needed.

**The platform's own zones.** `signatories.org` and `signatories.app` are
Cloud DNS zones in *this* project (`tf/dns.tf`), so their records — including
`sites.signatories.org`, the alias every customer CNAMEs to — are `tofu`'s,
not hand work. Two things still live at the registrar:

- the **name servers**, from the `signatories_org_name_servers` /
  `signatories_app_name_servers` outputs;
- the **DS record**. DNSSEC is on for both zones: Cloud DNS signs them, but
  nothing validates until the registrar publishes the DS record for the
  key-signing key. Read it out and paste it into the registrar's DNSSEC
  form:

  ```sh
  gcloud dns dns-keys list --zone=signatories-org --project=community-drafter
  gcloud dns dns-keys describe 0 --zone=signatories-org \
    --project=community-drafter --format='value(ds_record())'
  ```

  (`0` is the `keySigning` key's ID from the first command; use
  `--zone=signatories-app` for the other domain.) A missing DS is not an
  outage — it is DNSSEC simply not in force — but it is easy to forget and
  invisible afterwards. Re-do it if the key-signing key is ever rotated.

### 7. Onboarding a site (a customer hostname)

One deployment answers on many hostnames; each is a **site** with its own name,
sender and operator group (`specs/behaviors/sites.md`). The platform itself is
**Signatories** at `signatories.org` — the default site, the marketing site and
the `sites.signatories.org` alias customers point their DNS at all live in that
zone. Four steps, in this order. Steps 1–3 are infrastructure and DNS; only
step 4 is data. Creating, changing or deleting a site is a superadmin action;
managing a site's operator group is not.

**1. Verify ownership of the domain.** Google refuses to create a domain
mapping unless the *account making the call* is a verified owner of the
domain. Verification belongs to a Google account, not to a project: being a
project owner is not enough, and a domain someone else verified does nothing
for us. Start by checking what the active account already holds:

```sh
gcloud domains list-user-verified
```

That command takes no `--project` — the list is the account's. As of
2026-09-20 it lists `jarv.us` (which is why the `drafter.jarv.us` mapping
exists) and neither `signatories.org` nor `signatories.app`, so the platform's
own domains still need this step before their first mapping.

If the base domain is not listed:

```sh
gcloud domains verify example.org
```

**This step is interactive and it needs a human with a browser.** It opens
Search Console signed in as whatever account `gcloud` is authenticated as, and
asks for a **Domain property**, which is verified by adding a TXT record of the
form `google-site-verification=<token>` at the base domain. There is no
non-interactive form, nothing in `tf/` does it, and — checked against the
Cloud Run documentation — a domain whose Cloud DNS zone happens to live in
this same project is **not** auto-verified. The only shortcut Google offers is
a domain bought through Google in the same account.

Verify the **base domain** (`example.org`), not the hostname the site will use.

Two ways to divide the work; prefer the first:

- **We hold the verification.** The project owner runs `gcloud domains verify
  example.org` in their own Google account, sends the customer the
  `google-site-verification` TXT record Search Console prints, and clicks
  *Verify* once the customer confirms it resolves (`dig +short TXT example.org`).
  This matches what the spec promises the customer: they add one record, we own
  the Google-side state.
- **The customer holds it.** They verify the property in their own account,
  then add ours as owners: Search Console → the property → *Settings* →
  *Users and permissions* → *Verified owners* → *Add an owner*.

Either way, **add every identity that will ever create a mapping for this
domain as a verified owner** — the human who applies `tf/` by hand *and* the CI
service account `community-drafter-ci@community-drafter.iam.gserviceaccount.com`.
An apply by an unlisted identity fails with *"Caller is not authorized to
administer the domain"*, which reads like an IAM problem and is not one.

For a hostname on one of the platform's own domains, the TXT record is ours to
add — either in `tf/dns.tf` next to the other records, or directly:

```sh
gcloud dns record-sets create signatories.app. --type=TXT --ttl=300 \
  --zone=signatories-app --project=community-drafter \
  --rrdatas='"google-site-verification=<token>"'
```

**2. Map the hostname.** Add it to `site_hostnames` in `tf/terraform.tfvars`
and apply, as an identity that is a verified owner of its domain (step 1).
`tf/cloudrun.tf` creates one `google_cloud_run_domain_mapping` per entry
alongside the deployment's own:

```sh
cd tf
tofu apply -concise
gcloud beta run domain-mappings describe --domain=letters.example.org \
  --project=community-drafter --region=us-east4 \
  --format='value(status.resourceRecords)'
```

(`beta` because the installed `gcloud` only accepts `--region` on the beta and
alpha tracks for `run domain-mappings`.) The mapping is created before DNS
exists; Cloud Run reports `CertificatePending` and waits.

**3. Point DNS at the service.** The customer adds a CNAME in their own zone
pointing the hostname at **`sites.signatories.org`**:

```
letters.example.org.   CNAME   sites.signatories.org.
```

`sites.signatories.org` is an alias the platform maintains in the
`signatories.org` zone (`tf/dns.tf`); it resolves to `ghs.googlehosted.com.`,
which is what `domain-mappings describe` prints. Hand customers the platform
alias, never Google's hostname directly: it is one name we control, so if the
target ever changes we edit one record instead of asking every customer to edit
theirs.

The certificate provisions automatically once the record resolves — usually
minutes, occasionally longer. No further apply. Check with
`gcloud beta run domain-mappings describe --domain=… --format='value(status.conditions)'`
or simply by loading the hostname over https.

**4. Create the site record.**

```sh
signatories-axi sites create example \
  --hostname letters.example.org \
  --name "Example Letters" \
  --reply-to team@example.org \
  --sender-email letters@example.org
signatories-axi sites operators add example someone@example.org
```

`sites create` prints, in one block, every DNS record the customer still has to
add. For the invocation above that block is exactly three records, and this
table is the same three — if the two ever disagree, one of them is a bug:

| type | name | value | why |
| --- | --- | --- | --- |
| `CNAME` | `letters.example.org` | `sites.signatories.org` | routes the hostname (step 3); the certificate follows on its own |
| `TXT` | `<the DKIM host Postmark shows>.example.org` | from Postmark | DKIM signing for this site's mail |
| `CNAME` | `pm-bounces.example.org` | from Postmark | Return-Path for this site's mail |

The CNAME is printed for every site; the two Postmark records only when
`--sender-email` is given. **Take those two values from the Postmark UI**
(Sender Signatures → the domain → DKIM / Return-Path): Postmark's DKIM host is
a timestamped selector ending `pm._domainkey`, and the Return-Path target has
been `pm.mtasv.net` at every check — but read both off the console rather than
assuming, and never invent them. Automating this through Postmark's Account API
is a follow-up, not something the service does today.

Until the sender's domain is verified in Postmark, mail from that site's
documents **fails per recipient** rather than going out under the platform's
address — that is deliberate (`specs/behaviors/notifications.md` § Sending).
Leave `--sender-email` off until verification is done and the site's mail goes
out from the platform address under the site's name, which is a fine place to
start.

Assign documents with `signatories-axi docs create <slug> --site example …` or
`signatories-axi docs update <slug> --site example`. A document with no `--site`
belongs to the default site, which is this deployment's own hostname, name and
sender — nothing about existing documents changes.

**Watch the ceiling.** It is not where it looks like it is:

- **Domain mappings themselves have no published per-project cap**, and
  `gcloud alpha services quota list --service=run.googleapis.com
  --consumer=projects/community-drafter` lists no domain-mapping metric at all
  (checked 2026-09-20), so there is no quota to read and none to raise. Current
  usage is **1** mapping — `drafter.jarv.us` — from `gcloud beta run
  domain-mappings list --project=community-drafter --region=us-east4`.
- **The real ceiling is certificates: 50 per top domain per week**, documented
  as a fixed limit that cannot be increased. Whitelabel hostnames under one of
  our own domains (`*.signatories.app`) all share that one budget; hostnames on
  customers' own domains each bring their own. Fifty whitelabel sites in a week
  is the wall, and it is a wait, not an error to appeal.
- Each certificate takes minutes. Onboard in batches rather than one apply per
  signup.

### 8. Signing in: a human, the CLI, and a bot operator

**A human**, at `/admin/login`: enter the operator's email, follow the
emailed magic link. Sessions last 24 hours.

**The CLI** (`signatories-axi`), device-code style — there's no password or
long-lived secret to copy around:

```sh
signatories-axi login you@jarv.us --url https://drafts.example.org
```

This sends the same magic-link email, prints an 8-character code, and
waits. Follow the link (or have the mailbox owner follow it, for a bot —
see below), click "Approve this device" on the page it lands on, and the
CLI finishes on its own: it writes the instance URL, the operator's email
and a 90-day token to `~/.config/signatories/default.toml` (mode 600). Every
later `signatories-axi` command reads from there and refreshes the token
silently once it's more than 30 days old; `signatories-axi logout` forgets it,
`signatories-axi whoami` shows who's signed in and until when.

Anyone who signed in when the tool was `drafter-axi` needs to do nothing:
a profile still in `~/.config/drafter/` is read as before, with one note
on stderr saying where it came from, and the next `login` writes it to
the new directory. `DRAFTER_URL` and `DRAFTER_TOKEN` in a CI job keep
working too, each behind its `SIGNATORIES_*` counterpart.

**A bot operator** (`kind: bot`, created with
`signatories-axi operators add bot@jarv.us --name "Release Bot" --kind bot`) has
its own mailbox but no hands to click a link with. Signing it in the first
time — and every time its 90-day token lapses without a human noticing — is
a human's job:

1. Run `signatories-axi login bot@jarv.us --url https://drafts.example.org` from
   wherever the bot's automation will read the resulting profile (its own
   machine/container, or a shared secret store the automation reads from).
2. A human with access to the bot's mailbox opens the magic-link email and
   approves the device on the page it lands on.
3. The CLI on the bot's side finishes and saves the token — the bot signs
   in under its own identity from then on, with its own `Actor` trailer on
   every commit it makes.

### 9. The `tofu plan` gate's read-only account

The pull-request plan gate (`.github/workflows/tf-plan.yml`) authenticates as
`community-drafter-ci-plan`, a second service account that holds viewer roles
only — the deploy account's admin roles have no business being mintable by
every pull request (`specs/architecture.md` § Deployment). The account, its
Workload Identity binding and its project roles are declared in `tf/iam.tf`;
like every other grant in that file they are applied from a workstation:

```sh
cd tf && tofu apply -concise
```

One grant it needs is **not** in `tf/`: read on the state bucket. The state
lives in `jarvus-tfstate`, which is outside this project and unmanaged by this
module, so the owner adds the binding by hand, once, after the apply above has
created the account:

```sh
gcloud storage buckets add-iam-policy-binding gs://jarvus-tfstate \
  --member=serviceAccount:community-drafter-ci-plan@community-drafter.iam.gserviceaccount.com \
  --role=roles/storage.objectViewer
```

`objectViewer` — read, not write — is enough because the workflow plans with
`-lock=false`: it reads the state object and never writes the lock object a
real apply takes. Until both steps are done the plan job fails at its
authentication step; the credential-free `tf-validate.yml` gate is unaffected.

Verify from the gate itself (re-run the `OpenTofu plan` check on any PR that
touches `tf/`) or locally:

```sh
gcloud storage ls gs://jarvus-tfstate/community-drafter/ \
  --impersonate-service-account=community-drafter-ci-plan@community-drafter.iam.gserviceaccount.com
```


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

### The one-time people-to-sites migration

The first boot of the build that moved `people` under its site
(`specs/data-model.md` § Migrating the pre-site layout) rewrites every
record from `people/<id>.toml` to `people/default/<id>.toml` with
`site = 'default'`, in one commit. Watch for it once:

- The log line `storage: migrated N people record(s) to site 'default'`,
  with `N` equal to the number of files that were directly under `people/`.
- One commit in the data repo with `Action: migrate` and `Actor: system`,
  whose diff is only renames-plus-one-added-field. The push daemon pushes
  it like any other commit.
- `/_health`'s `storage.people` afterwards equal to `N`. The read model is
  built before the migration runs, so the `storage: read model built` line
  at boot reports `people: 0` on this one boot — that is expected, and the
  health endpoint is the count to trust.

Every later boot finds nothing to move and commits nothing. If the log line
appears on a second boot, something is writing records back to the old
path and that is a bug, not a retry.

## Writing a document's text

A document's body is GitHub-flavoured Markdown, rendered once per version
by the shared pipeline (`specs/behaviors/versioning.md` § Rendering). Raw
HTML is stripped, so anything you want on the page has to be expressible in
Markdown or in one of the extensions below.

### Citations

Write citations as ordinary inline links. There is no bibliography to keep
in step — the links *are* the bibliography:

```markdown
Announced with less than a month's [notice](https://example.org/story) and
without a [roadmap](https://example.org/other).
```

How they present is a reader-side or export-side choice, not an authoring
one (`specs/behaviors/versioning.md` § Citations):

| Mode | What a reader gets | Where |
| --- | --- | --- |
| `links` | links, nothing appended | the web default |
| `footnotes` | plain text + superscript numbers + a **Sources** list | the web reader toggle "Sources as footnotes" |
| `hybrid` | clickable links **and** the numbers and the Sources list | the PDF default |

- Numbering is by first appearance. The same URL cited twice keeps one
  number and one entry — including when the two links differ only by a
  `#:~:text=` highlight fragment, which is how a browser's "copy link to
  highlight" writes them.
- A link whose visible text is itself a URL never gets a number: the
  address is already on the page.
- `[^1]`-style Markdown footnotes still work and are separate from Sources.

Force a mode on any URL with `?citations=links|footnotes|hybrid`, or on an
export with `signatories-axi docs export <slug> --pdf --citations footnotes`.

### Section breaks

A `---` on its own line between blocks renders as a short centered
hairline with air around it — a pause between movements, not a divider.

### Block classes

Four classes are available, and only four: `lede`, `callout`, `small`,
`center`. Mark a single paragraph or heading with a trailing `{.class}`:

```markdown
We are asking for a written, interim agreement by December 31st. {.lede}
```

Mark a run of blocks with a fenced container (a leading `:::` line naming
the class, a closing `:::` line; the space after the colons is optional):

```markdown
::: callout
**Our proposal for a temporary, written agreement**

No sale, long-term lease, or transfer of the building.
:::
```

Anything outside the four is discarded — the class never reaches the page
and the marker never shows up as literal text. A container is a wrapper
only: the paragraphs inside it stay the units people comment on, so adding
or removing one never orphans a comment.
