# Two product secrets already exist in Secret Manager with real populated
# versions (created by the operator before this module's first apply).
# Reference them by data source rather than `google_secret_manager_secret`
# resources — a resource + placeholder version (the proposal-renderer
# pattern) would be fine for a brand-new secret, but these already hold real
# values and a managed placeholder version risks clobbering them.
#
# `community-drafter-cookie-secret` predates `operators-auth` (it signed the
# old Google-OAuth admin session cookie) and is reused as-is for
# `AUTH_SECRET` — only the Cloud Run env var name changes (`cloudrun.tf`);
# the secret's random value is already a suitable HS256 signing key and
# rotating it would invalidate every outstanding operator token for no
# benefit.

data "google_secret_manager_secret" "deploy_key" {
  secret_id = "community-drafter-deploy-key"
}

data "google_secret_manager_secret" "auth_secret" {
  secret_id = "community-drafter-cookie-secret"
}

resource "google_secret_manager_secret_iam_member" "deploy_key_accessor" {
  secret_id = data.google_secret_manager_secret.deploy_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "auth_secret_accessor" {
  secret_id = data.google_secret_manager_secret.auth_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

# --- Data-repository refresh webhook (specs/behaviors/operators.md) ---
#
# `community-drafter-webhook-secret` doesn't exist yet. Created here with a
# placeholder version (the proposal-renderer pattern) and
# `ignore_changes = [secret_data]` so a real value can be set out of band
# (`gcloud secrets versions add`, per docs/operations.md) without `tofu plan`
# ever proposing to revert it back to the placeholder.
resource "google_secret_manager_secret" "webhook_secret" {
  secret_id = "community-drafter-webhook-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "webhook_secret" {
  secret      = google_secret_manager_secret.webhook_secret.id
  secret_data = "placeholder-rotate-before-use"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "webhook_secret_accessor" {
  secret_id = google_secret_manager_secret.webhook_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}
