---
status: planned
depends:
  - sites
issues: []
specs:
  - specs/behaviors/sites.md
  - specs/architecture.md
---

# Plan: site-hostnames

## Scope

Make a customer hostname actually reach the service, and write down how an operator onboards one.

**In:** a `site_hostnames` list variable in `tf/`; one `google_cloud_run_domain_mapping` per entry via `for_each`, alongside the existing single mapping; the onboarding procedure in `docs/operations.md` (domain verification → mapping → CNAME → `sites create`); and the DNS block the CLI prints, verified against what Cloud Run and Postmark actually ask for.

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
5. Check the project's current domain-mapping quota and record the number in the runbook next to the "watch the ceiling" note, so the first person to hit it knows what they hit.

## Validation

- [ ] `tofu plan -concise` with `site_hostnames = []` produces no change against the deployed state — adding the variable alone is a no-op.
- [ ] Adding one hostname produces exactly one new `google_cloud_run_domain_mapping` and touches nothing else; removing it removes only that mapping.
- [ ] One hostname is taken end to end on the live instance: verified to the project, mapped, CNAME added, certificate provisioned, and a document assigned to its site loads on it over https with the site's name in the bar.
- [ ] The DNS block `sites create` prints matches, record for record, what Cloud Run and Postmark actually required for that hostname — corrected in the CLI if it does not.
- [ ] `docs/operations.md` step 7 is followed by someone who did not write it, start to finish, without needing anything not on the page.
- [ ] The current per-project domain-mapping quota is recorded in the runbook.

## Risks / unknowns

- **Domain verification cannot be automated from `tf/`.** It is a Google-side proof of ownership performed by whoever controls the domain. A mapping for an unverified domain fails the apply, so the runbook's step order is load-bearing, not advisory.
- **Per-project mapping limits and slow provisioning.** Cloud Run caps domain mappings per project and each certificate takes minutes to appear. A large batch of customers is a quota conversation with Google, not a bigger apply — this is the known ceiling on the whole approach.
- **A hostname mapped but not recorded** (or recorded but not mapped) is the confusing middle state. The application already makes it inert and honest (`specs/behaviors/sites.md`); the runbook has to make the order obvious enough that operators rarely produce it.
- **Removing a hostname breaks live links.** Personal links already sent point at it. Treat a removal as a migration — move the documents to another site first — not as a `tofu` edit.

## Notes

(At closeout.)

## Follow-ups

(At closeout.)
