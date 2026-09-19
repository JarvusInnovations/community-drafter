# community-drafter — Cloud Run deployment of the single production instance
# (specs/architecture.md § Deployment). Shape and provider versions follow
# proposal-renderer's tf/ (read-only reference at deploy time), itself modeled
# on jarvus-allocator.
#
# The GCP project (`community-drafter`, org jarv.us), billing link, and API
# enablement listed below were already done by the operator before this
# module's first apply; the `google_project_service` resources here just
# capture that state as managed (idempotent — enabling an already-enabled
# API is a no-op) so a future fresh project bootstraps the same way.
#
# The three product secrets (`community-drafter-deploy-key`,
# `community-drafter-admin-token`, `community-drafter-cookie-secret`) and the
# private data repo already exist with real values populated — see
# `secrets.tf`, which references them as `data` sources rather than creating
# placeholder versions that would overwrite the operator-populated ones.

terraform {
  required_version = ">= 1.6"

  backend "gcs" {
    bucket = "jarvus-tfstate"
    prefix = "community-drafter/"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "project" {}

# cloudresourcemanager: the google provider itself calls this when refreshing
# `google_project_iam_member` state. iam / iamcredentials: service accounts
# and Workload Identity Federation token exchange. run / artifactregistry /
# secretmanager: the resources this module manages directly. cloudbuild:
# listed in the operator's pre-enabled set (not otherwise used by this
# module, which builds images locally / in GitHub Actions rather than via
# Cloud Build) — captured here anyway so `tofu plan` doesn't show it as
# unmanaged drift.
resource "google_project_service" "cloudresourcemanager" {
  service            = "cloudresourcemanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iam" {
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iamcredentials" {
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}
