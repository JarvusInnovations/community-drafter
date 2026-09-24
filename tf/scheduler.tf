# The scheduler tick (specs/architecture.md § Deployment, "The scheduler").
#
# The service scales to zero, so nothing scheduled can live on a timer in
# the process. Cloud Scheduler calls POST /internal/tick every 15 minutes
# instead, with an OIDC ID token Google signs for a dedicated service
# account; the app verifies the token's signature, issuer, audience and
# email itself (the service is publicly invokable, so Cloud Run IAM does not
# check it). No shared secret exists. A tick against a scaled-to-zero
# service starts it, which is intended.

locals {
  # Any string works as an ID-token audience; it only has to match what the
  # app is told to expect (TICK_AUDIENCE in cloudrun.tf).
  tick_audience = "signatories-internal-tick"
}

resource "google_project_service" "cloudscheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

# The tick's own identity. It holds nothing but the right to invoke the
# service, and the app accepts a tick only from this address.
resource "google_service_account" "tick" {
  account_id   = "community-drafter-tick"
  display_name = "Community Drafter scheduler tick"
}

# Redundant while `allUsers` can invoke the service (cloudrun.tf), but it
# keeps the tick working if public invocation is ever narrowed.
resource "google_cloud_run_v2_service_iam_member" "tick_invoker" {
  name     = google_cloud_run_v2_service.community_drafter.name
  location = google_cloud_run_v2_service.community_drafter.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tick.email}"
}

resource "google_cloud_scheduler_job" "tick" {
  name        = "community-drafter-tick"
  description = "POST /internal/tick: open-count flush, push retry, phase observer, operator digest"
  region      = var.region
  schedule    = "*/15 * * * *"
  time_zone   = "Etc/UTC"
  # A tick may have to wait for a cold start (clone + read model).
  attempt_deadline = "120s"

  # Every step is idempotent and the next tick is 15 minutes away; one
  # retry covers a cold start that missed the deadline.
  retry_config {
    retry_count          = 1
    min_backoff_duration = "30s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.community_drafter.uri}/internal/tick"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode("{}")

    oidc_token {
      service_account_email = google_service_account.tick.email
      audience              = local.tick_audience
    }
  }

  depends_on = [google_project_service.cloudscheduler]
}
