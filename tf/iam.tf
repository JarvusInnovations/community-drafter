# Runtime service account for the Cloud Run instance. Holds the
# secret-accessor bindings declared in `secrets.tf`.
resource "google_service_account" "cloudrun" {
  account_id   = "community-drafter"
  display_name = "Community Drafter Cloud Run Service"
}

# CI/CD service account assumed by GitHub Actions via Workload Identity
# Federation for the release-triggered publish workflow.
resource "google_service_account" "github_actions" {
  # account_id max is 30 chars; "community-drafter-github-actions" (33) is
  # over, hence the shortened "-ci" suffix.
  account_id   = "community-drafter-ci"
  display_name = "Community Drafter CI/CD"
}

# --- Workload Identity Federation ---
#
# One pool + OIDC provider trusting GitHub's OIDC issuer, scoped to this
# repo only via attribute_condition. No long-lived key ever leaves GCP.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Workload identity pool for GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github_actions" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "community-drafter-github-actions"
  display_name                       = "community-drafter CI"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }
  # Scope trust to this exact repo — nothing else can assume the CI SA.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_actions_wif" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# CI needs to push images to the registry...
resource "google_artifact_registry_repository_iam_member" "github_actions_writer" {
  location   = google_artifact_registry_repository.community_drafter.location
  repository = google_artifact_registry_repository.community_drafter.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_actions.email}"
}

# ...and apply Terraform changes (so it can roll out new image tags).
resource "google_project_iam_member" "github_actions_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Cloud Run admins need to actAs the runtime service account when
# creating/updating revisions.
resource "google_service_account_iam_member" "github_actions_actas_runtime" {
  service_account_id = google_service_account.cloudrun.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_actions.email}"
}

# `data "google_project"` lookups (used in cloudrun.tf's domain mapping)
# need this.
resource "google_project_iam_member" "github_actions_browser" {
  project = var.project_id
  role    = "roles/browser"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Deliberately narrower than the proposal-renderer/jarvus-allocator
# template's CI IAM (which grants the CI SA project-wide *Admin roles —
# iam.serviceAccountAdmin, secretmanager.admin, artifactregistry.admin,
# serviceusage.serviceUsageAdmin — so CI can self-manage IAM/secrets/registry
# settings, not just image tags). Those broad standing admin grants were
# refused when this module's first apply was run under an operator session
# with a permission-grant safety gate: narrow, resource-scoped bindings
# (the ones above, plus the viewer-level ones below) went through; anything
# shaped "project-wide *Admin for a CI robot" did not.
#
# Consequence: CI's `tofu plan`/`apply` on a routine image-tag bump can read
# (refresh) secret/registry/service state via the viewer roles below, but
# cannot create the optional Google OAuth secrets (secrets.tf) or manage
# project IAM bindings (this file) on its own — those still need a human
# operator to `tofu apply` from a trusted workstation session, same as the
# original bootstrap. See plans/deploy.md Follow-ups.
#
# Update 2026-09-19: the operator authorized the full template grants
# (issue #7). They are declared below; applying them still has to happen
# from a session without that gate (`cd tf && tofu apply -concise`).
resource "google_project_iam_member" "github_actions_secretmanager_admin" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_artifactregistry_admin" {
  project = var.project_id
  role    = "roles/artifactregistry.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_serviceaccount_admin" {
  project = var.project_id
  role    = "roles/iam.serviceAccountAdmin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_project_iam_admin" {
  project = var.project_id
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_serviceusage_admin" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageAdmin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Update 2026-09-21: the state now holds the platform's Cloud DNS zones
# (dns.tf) and the Workload Identity pool above, and the restored PR plan
# gate (#8) refreshes all of it under this account. Without these two the
# plan — and the release apply — 403 on the zones and the pool. The
# operator authorized every grant the deployment and its CI need (#92);
# applied from an operator session, like the grants above.
resource "google_project_iam_member" "github_actions_dns_admin" {
  project = var.project_id
  role    = "roles/dns.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_wif_pool_admin" {
  project = var.project_id
  role    = "roles/iam.workloadIdentityPoolAdmin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# The scheduler tick (scheduler.tf): the release apply manages the Cloud
# Scheduler job, and creating or updating a job whose OIDC token names the
# tick service account requires acting as that account.
resource "google_project_iam_member" "github_actions_cloudscheduler_admin" {
  project = var.project_id
  role    = "roles/cloudscheduler.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_service_account_iam_member" "github_actions_actas_tick" {
  service_account_id = google_service_account.tick.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_actions.email}"
}

# --- The pull-request `tofu plan` gate's own principal (#99) ---
#
# `specs/architecture.md` § Deployment: the read-only plan gate "runs under a
# second, read-only service account of its own ... a plan that authenticates
# as the deploy account is one typo in a workflow away from being an apply."
# Everything below is read-only; the account can refresh state and nothing
# else.
resource "google_service_account" "github_actions_plan" {
  # 30-char account_id ceiling again: "community-drafter-ci-plan" is 25.
  account_id   = "community-drafter-ci-plan"
  display_name = "Community Drafter CI plan (read-only)"
}

# The same pool and repo condition as the deploy account's binding above.
# The provider maps `google.subject` and `attribute.repository` only, so
# there is no `event_name` attribute to bind a pull-request-only principal
# set to; scoping this binding to the event would mean editing the trust
# attributes of the provider the deploy account also assumes, which is a
# change to make deliberately and on its own. What makes a repo-scoped
# binding safe here is the role set: every grant below is a viewer.
resource "google_service_account_iam_member" "github_actions_plan_wif" {
  service_account_id = google_service_account.github_actions_plan.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# The resources this module declares, each read by `tofu plan`'s refresh:
# Cloud Run services and the domain mappings, secrets (metadata only — never
# a payload), the image registry, the DNS zones and records, and the
# Workload Identity pool and provider.
resource "google_project_iam_member" "github_actions_plan_run_viewer" {
  project = var.project_id
  role    = "roles/run.viewer"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

resource "google_project_iam_member" "github_actions_plan_secretmanager_viewer" {
  project = var.project_id
  role    = "roles/secretmanager.viewer"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

resource "google_project_iam_member" "github_actions_plan_artifactregistry_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

resource "google_project_iam_member" "github_actions_plan_dns_reader" {
  project = var.project_id
  role    = "roles/dns.reader"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

resource "google_project_iam_member" "github_actions_plan_wif_pool_viewer" {
  project = var.project_id
  role    = "roles/iam.workloadIdentityPoolViewer"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

# The Cloud Scheduler job (scheduler.tf).
resource "google_project_iam_member" "github_actions_plan_cloudscheduler_viewer" {
  project = var.project_id
  role    = "roles/cloudscheduler.viewer"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

# `data "google_project"` (cloudrun.tf's domain mapping), same as the deploy
# account's grant above.
resource "google_project_iam_member" "github_actions_plan_browser" {
  project = var.project_id
  role    = "roles/browser"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

# The three reads the viewer roles above do not cover, and without which the
# refresh 403s on this module's own resources — the failure mode #92 was:
# `google_project_service` needs `serviceusage.services.get`; the two
# `google_service_account` resources need `iam.serviceAccounts.get`; and
# every `*_iam_member` needs a `getIamPolicy` on its resource, which
# securityReviewer grants across services. All three are read-only.
resource "google_project_iam_member" "github_actions_plan_serviceusage_viewer" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageViewer"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

resource "google_project_iam_member" "github_actions_plan_serviceaccount_viewer" {
  project = var.project_id
  role    = "roles/iam.serviceAccountViewer"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

resource "google_project_iam_member" "github_actions_plan_security_reviewer" {
  project = var.project_id
  role    = "roles/iam.securityReviewer"
  member  = "serviceAccount:${google_service_account.github_actions_plan.email}"
}

# Not declared here: `roles/storage.objectViewer` on the `jarvus-tfstate`
# bucket, which holds this module's state. That bucket lives outside this
# project and `tf/` manages none of its IAM, so granting it from here would
# mean adopting a resource this module has no business owning. The owner
# runs the one binding by hand — `docs/operations.md` § The `tofu plan` gate's
# read-only account. With `-lock=false` (which the plan workflow already
# passes) object read is enough: a plan reads the state object and takes no
# lock.
