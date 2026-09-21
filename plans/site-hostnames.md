---
status: done
depends:
  - sites
issues: []
pr: 101
specs:
  - specs/behaviors/sites.md
  - specs/architecture.md
---

# Plan: site-hostnames

## Scope

Make a customer hostname actually reach the service, and write down how an operator onboards one.

**In:** a `site_hostnames` list variable in `tf/`; one `google_cloud_run_domain_mapping` per entry via `for_each`, alongside the existing single mapping; the `sites.signatories.org` alias in the platform's own zone that every customer CNAMEs to; the onboarding procedure in `docs/operations.md` (domain verification → mapping → CNAME → `sites create`); and the DNS block the CLI prints, verified against what Cloud Run and Postmark actually ask for.

**Out:** the application behavior — [`sites`](sites.md), which this depends on. Out too: a load balancer (decided against; see `specs/architecture.md` § Sites), automating domain verification, automating Postmark sender verification through its Account API (a listed follow-up), and managing any customer's DNS zone, which the platform deliberately cannot touch.

Small plan: one variable, one `for_each`, one runbook section, and one careful pass over the printed records.

## Implements

- `specs/architecture.md` § Sites, the infrastructure half: Cloud Run domain mappings, one per hostname, declared in `tf/`.
- `specs/behaviors/sites.md` § Onboarding a hostname (the four steps, in order) and § What a site is not ("Not DNS" — the record and the mapping are separate systems on purpose).
- `docs/operations.md` step 7, which is the operator-facing form of both.

## Approach

1. `variable "site_hostnames" { type = list(string), default = [] }` in `tf/variables.tf`, documented as "hostnames already verified to the project; each gets a Cloud Run domain mapping" and pinned in `tf/terraform.tfvars` like `image_tag` and `public_url`.
2. `google_cloud_run_domain_mapping.sites` with `for_each = toset(var.site_hostnames)`, mirroring the existing `community_drafter` mapping's `metadata.namespace` and `spec.route_name`. Keep the existing resource as it is rather than folding the deployment's own hostname into the list — it is addressed by its own variable, and merging the two would churn state for no gain.
3. Confirm the current action/resource shape with `gh-axi repo view` on any action touched and with the provider docs for the pinned Google provider version before writing; `tofu fmt` and `tofu validate` are the gate.
4. `docs/operations.md`: the four-step section (already drafted on this branch with the spec) reconciled against what a real onboarding prints — the `gcloud domains verify` step, the `domain-mappings describe` output, the CNAME target, and the two Postmark record names — and corrected where it differs.
5. Create `sites.signatories.org` in the `signatories.org` zone as a CNAME to `ghs.googlehosted.com.`, and confirm a customer hostname CNAMEd to *it* provisions a certificate exactly as one pointed straight at Google does. That indirection is the whole reason customers are never given Google's hostname, so it has to be proven once before any customer is onboarded onto it.
6. Check the project's current domain-mapping quota and record the number in the runbook next to the "watch the ceiling" note, so the first person to hit it knows what they hit.

## Validation

- [x] `tofu plan -concise` with `site_hostnames = []` produces no change against the deployed state — adding the variable alone is a no-op. Plan is `1 to add, 0 to change, 0 to destroy`, and the one addition is `google_dns_record_set.sites_alias`, which this plan also introduces; the variable and its `for_each` contribute nothing.
- [x] Adding one hostname produces exactly one new `google_cloud_run_domain_mapping` and touches nothing else; removing it removes only that mapping. `tofu plan -var='site_hostnames=["demo.signatories.app"]'` is `2 to add, 0 to change, 0 to destroy` — the alias plus `google_cloud_run_domain_mapping.sites["demo.signatories.app"]` (`certificate_mode = "AUTOMATIC"`, `route_name = "community-drafter"`). Keyed by hostname, so a removal is symmetric: the empty-list plan above is exactly the state without it.
- [ ] `sites.signatories.org` exists and resolves to `ghs.googlehosted.com.` — **the coordinator's, after apply from the main checkout.** The record is planned but not applied: applying from a worktree that lags `develop` caused a rollback once. Verify with `dig +short sites.signatories.org` (expect `ghs.googlehosted.com.`).
- [ ] One hostname is taken end to end on the live instance: verified to the project, mapped, CNAMEd **to `sites.signatories.org`**, certificate provisioned, and a document assigned to its site loads on it over https with the site's name in the bar. **The coordinator's, after apply.** Suggested first hostname: `demo.signatories.app`, which needs no customer. The steps, in order: (1) `gcloud domains verify signatories.app` as the project owner — interactive, opens Search Console, asks for a Domain property; add the `google-site-verification` TXT it prints to the `signatories-app` zone (`gcloud dns record-sets create signatories.app. --type=TXT --ttl=300 --zone=signatories-app --rrdatas='"google-site-verification=<token>"'`) and click Verify, then add `community-drafter-ci@community-drafter.iam.gserviceaccount.com` as a verified owner; (2) `site_hostnames = ["demo.signatories.app"]` in the tfvars and `tofu apply -concise`; (3) a `demo` CNAME in the `signatories-app` zone pointing at `sites.signatories.org.` — this is the chained-CNAME step the whole indirection rests on, and it is what this box proves; (4) `drafter-axi sites create demo --hostname demo.signatories.app --name …` and load a document on it over https.
- [x] The DNS block `sites create` prints matches, record for record, what Cloud Run and Postmark actually required for that hostname — corrected in the CLI if it does not. No correction needed. `apps/api/src/sites/dns.ts` prints the hostname CNAME to `sites.signatories.org`, a DKIM `TXT` at the selector host Postmark shows, and a Return-Path `CNAME` at `pm-bounces.<domain>`; Cloud Run's live mapping asks for `CNAME → ghs.googlehosted.com.` (which is what the alias resolves to) and Postmark documents a timestamped `…pm._domainkey` selector with a `pm.mtasv.net` Return-Path target. `docs/operations.md` step 7 now tabulates the same three records, so a future drift between runbook and CLI is visible. Confirmation against a *live* hostname's own values rides with the end-to-end box above.
- [ ] `docs/operations.md` step 7 is followed by someone who did not write it, start to finish, without needing anything not on the page. Not attemptable from here — it wants a second person and a real onboarding. The end-to-end run above is its first opportunity.
- [x] The current per-project domain-mapping quota is recorded in the runbook. There is none to record, and the runbook now says so explicitly along with what the real ceiling is: see Notes.

## Risks / unknowns

- **Domain verification cannot be automated from `tf/`.** It is a Google-side proof of ownership performed by whoever controls the domain. A mapping for an unverified domain fails the apply, so the runbook's step order is load-bearing, not advisory.
- **Per-project mapping limits and slow provisioning.** Cloud Run caps domain mappings per project and each certificate takes minutes to appear. A large batch of customers is a quota conversation with Google, not a bigger apply — this is the known ceiling on the whole approach.
- **A hostname mapped but not recorded** (or recorded but not mapped) is the confusing middle state. The application already makes it inert and honest (`specs/behaviors/sites.md`); the runbook has to make the order obvious enough that operators rarely produce it.
- **The alias is a single point of failure.** Every customer's DNS points at `sites.signatories.org`; an accidental edit or an expired `signatories.org` registration takes every whitelabel hostname down at once. That is the trade accepted for being able to move the target without touching a customer's zone — keep the record and the registration where the platform team can see both.
- **Removing a hostname breaks live links.** Personal links already sent point at it. Treat a removal as a migration — move the documents to another site first — not as a `tofu` edit.

## Notes

**The ceiling is not where this plan thought it was.** Risks assumed a per-project cap on domain mappings. There isn't one: Cloud Run publishes no such limit, and `gcloud alpha services quota list --service=run.googleapis.com --consumer=projects/community-drafter` returns no domain-mapping metric at all — nothing to read, nothing to raise. The binding limit is **50 SSL certificates per top domain per week**, documented as fixed and not increasable. That reverses the shape of the risk: a batch of whitelabel hostnames under `signatories.app` all draw on one weekly budget, while the same batch spread across customers' own domains each draw on their own. Current usage is one mapping (`drafter.jarv.us`). `specs/architecture.md` § Sites was corrected to say this.

**Verification belongs to a Google account, not to a project.** `gcloud domains verify` opens Search Console in a browser as whatever account `gcloud` is authenticated as and asks for a Domain property proved by a `google-site-verification` TXT record at the base domain. There is no non-interactive form, nothing in `tf/` does it, and a domain whose Cloud DNS zone lives in this same project is *not* auto-verified — the only shortcut Google offers is a domain bought through Google in the same account. The consequence that will bite: **every identity that creates a mapping must be a verified owner**, so a release-time apply from CI needs `community-drafter-ci@community-drafter.iam.gserviceaccount.com` added as an owner of each domain's property or it fails with *"Caller is not authorized to administer the domain"* — an error that reads like IAM and is not. `specs/behaviors/sites.md` step 1 was corrected to say this.

**Neither platform domain is verified yet.** `gcloud domains list-user-verified` lists `jarv.us` (which is why the existing mapping works) and neither `signatories.org` nor `signatories.app`. The first whitelabel hostname is gated on that, not on this plan.

**Small gotcha:** the installed `gcloud` only accepts `--region` for `run domain-mappings` on the `beta`/`alpha` tracks. The runbook's commands say `gcloud beta run domain-mappings …` for that reason.

**Nothing was applied from this worktree**, deliberately. The `tf/` half of this plan is proven by `tofu validate` plus two read-only plans (empty list, and one hostname) and by the CI `tofu plan` gate on PR #101; the apply is the coordinator's from the main checkout.

## Follow-ups

- **Verify `signatories.org` and `signatories.app` to the project owner's account, and add the CI service account as a verified owner of each.** Interactive, blocks the first hostname on either domain. Tracked as the first step of this plan's end-to-end validation box; the commands are in `docs/operations.md` step 7.
- **Publish the DS record for both zones at the registrar.** DNSSEC is on in `tf/dns.tf` but nothing validates until the registrar carries the DS. Not an outage, and invisible once forgotten — the runbook's step 6 now carries the `gcloud dns dns-keys describe` command.
- **The `google-site-verification` TXT records for the platform's own zones should land in `tf/dns.tf`** once their tokens exist, rather than being created by hand — they are records in a zone this module already manages.
- **Automating Postmark sender verification through its Account API** stays out of scope, as this plan's Scope said. Today the two records' values are read off the Postmark console by a human.
- No downstream plan absorbs anything from this one.
