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
        name  = "INSTANCE_NAME"
        value = var.instance_name
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

      # Admin auth + session-cookie secrets — pulled from Secret Manager at
      # startup, never baked into the image or plain env.
      env {
        name = "ADMIN_TOKEN"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.admin_token.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "COOKIE_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.cookie_secret.secret_id
            version = "latest"
          }
        }
      }

      # Google OAuth — only wired once the operator sets both tfvars (see
      # secrets.tf). Until then admin auth is ADMIN_TOKEN-only.
      dynamic "env" {
        for_each = length(google_secret_manager_secret.google_client_id) > 0 ? [1] : []
        content {
          name = "GOOGLE_CLIENT_ID"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.google_client_id[0].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = length(google_secret_manager_secret.google_client_secret) > 0 ? [1] : []
        content {
          name = "GOOGLE_CLIENT_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.google_client_secret[0].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = length(google_secret_manager_secret.google_client_id) > 0 && var.oauth_allowed_emails != "" ? [var.oauth_allowed_emails] : []
        content {
          name  = "OAUTH_ALLOWED_EMAILS"
          value = env.value
        }
      }
      dynamic "env" {
        for_each = length(google_secret_manager_secret.google_client_id) > 0 && var.oauth_allowed_domains != "" ? [var.oauth_allowed_domains] : []
        content {
          name  = "OAUTH_ALLOWED_DOMAINS"
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
    google_secret_manager_secret_iam_member.admin_token_accessor,
    google_secret_manager_secret_iam_member.cookie_secret_accessor,
  ]
}

# Public invocation. Participant links carry their own opaque-token auth
# inside the app; admin routes are gated by ADMIN_TOKEN / OAuth, not Cloud
# Run IAM.
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
