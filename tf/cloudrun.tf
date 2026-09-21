resource "google_cloud_run_v2_service" "community_drafter" {
  name     = "community-drafter"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # No recreate-cost concerns: all state lives in the data repo on GitHub,
  # not in this Cloud Run resource.
  deletion_protection = false

  template {
    service_account = google_service_account.cloudrun.email

    # Singleton (specs/architecture.md § Deployment: "max_instance_count = 1
    # (load-bearing: single writer)"). min = 1 so a participant's first
    # click never pays for a cold clone of the data repo.
    scaling {
      max_instance_count = 1
      min_instance_count = 1
    }

    containers {
      name  = "community-drafter"
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.community_drafter.repository_id}/community-drafter:${var.image_tag}"

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
      }
      env {
        name  = "DATA_REPO_URL"
        value = var.data_repo_url
      }
      env {
        name  = "DATA_REPO_BRANCH"
        value = var.data_repo_branch
      }
      env {
        name  = "MAILER"
        value = var.mailer
      }
      env {
        name = "POSTMARK_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.postmark_token.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "INSTANCE_NAME"
        value = var.instance_name
      }
      env {
        name  = "AUTH_LOGIN_RATE_LIMIT"
        value = tostring(var.auth_login_rate_limit)
      }
      env {
        name  = "INSTANCE_FROM_EMAIL"
        value = var.instance_from_email
      }
      env {
        name  = "INSTANCE_TIMEZONE"
        value = var.instance_timezone
      }
      env {
        name  = "DEPLOY_KEY_PATH"
        value = "/secrets/deploy-key/latest"
      }

      # Empty until a second apply sets it from the service_url output (or
      # the domain mapping below finishes verification).
      dynamic "env" {
        for_each = var.public_url != "" ? [var.public_url] : []
        content {
          name  = "PUBLIC_URL"
          value = env.value
        }
      }

      # Operator auth secrets — pulled from Secret Manager at startup, never
      # baked into the image or plain env (specs/behaviors/operators.md).
      env {
        name = "AUTH_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.auth_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "DATA_REPO_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.webhook_secret.secret_id
            version = "latest"
          }
        }
      }

      # The only way the first operator comes into existence — see
      # var.bootstrap_operator_email. Omitted (not merely empty) when unset,
      # so the storage layer's "is this variable set at all" check behaves
      # the same as a bare, unconfigured environment.
      dynamic "env" {
        for_each = var.bootstrap_operator_email != null ? [var.bootstrap_operator_email] : []
        content {
          name  = "BOOTSTRAP_OPERATOR_EMAIL"
          value = env.value
        }
      }

      # Probes hit `/_health` (no auth required, returns 200 once
      # `server.listen` has fired and the storage plugin's boot clone of
      # the data repo has completed).
      startup_probe {
        http_get {
          path = "/_health"
          port = 8080
        }
        initial_delay_seconds = 0
        period_seconds        = 4
        # Generous window (§ risk in plans/deploy.md: "the boot clone must
        # finish within the startup probe window") — 40 x 4s = 160s budget.
        failure_threshold = 40
        timeout_seconds   = 3
      }

      liveness_probe {
        http_get {
          path = "/_health"
          port = 8080
        }
        period_seconds    = 30
        failure_threshold = 3
        timeout_seconds   = 3
      }

      volume_mounts {
        name       = "deploy-key"
        mount_path = "/secrets/deploy-key"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
    }

    volumes {
      name = "deploy-key"
      secret {
        secret       = data.google_secret_manager_secret.deploy_key.secret_id
        default_mode = 256 # 0400 octal
        items {
          version = "latest"
          path    = "latest"
        }
      }
    }
  }

  depends_on = [
    google_artifact_registry_repository.community_drafter,
    google_secret_manager_secret_iam_member.deploy_key_accessor,
    google_secret_manager_secret_iam_member.auth_secret_accessor,
    google_secret_manager_secret_iam_member.webhook_secret_accessor,
    google_secret_manager_secret_iam_member.postmark_token_accessor,
  ]
}

# Public invocation. Participant links carry their own opaque-token auth
# inside the app; admin routes are gated by operator tokens (magic-link
# sessions, device-code CLI tokens), not Cloud Run IAM.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.community_drafter.name
  location = google_cloud_run_v2_service.community_drafter.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Custom domain. The operator adds the DNS CNAME in another project; if the
# mapping fails on domain verification before that DNS exists, this is the
# resource to comment out and note (see docs/operations.md).
resource "google_cloud_run_domain_mapping" "community_drafter" {
  count    = var.domain_mapping == null ? 0 : 1
  name     = var.domain_mapping
  location = google_cloud_run_v2_service.community_drafter.location

  metadata {
    namespace = data.google_project.project.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.community_drafter.name
  }
}

# Customer site hostnames — one mapping each (specs/architecture.md § Sites;
# specs/behaviors/sites.md § Onboarding a hostname). Kept separate from the
# deployment's own mapping above rather than folded into the list: that one
# is addressed by var.domain_mapping, and merging the two would churn state
# for no gain.
#
# Every entry must already be verified to the identity running the apply, or
# the create fails with "Caller is not authorized to administer the domain".
# The customer's CNAME points at sites.signatories.org (tf/dns.tf), never at
# Google's hostname directly.
resource "google_cloud_run_domain_mapping" "sites" {
  for_each = toset(var.site_hostnames)

  name     = each.value
  location = google_cloud_run_v2_service.community_drafter.location

  metadata {
    namespace = data.google_project.project.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.community_drafter.name
  }
}
