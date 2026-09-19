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
resource "google_project_iam_member" "github_actions_secretmanager_viewer" {
  project = var.project_id
  role    = "roles/secretmanager.viewer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_actions_serviceusage_viewer" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageViewer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}
