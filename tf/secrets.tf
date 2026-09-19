# The three product secrets already exist in Secret Manager with real
# populated versions (created by the operator before this module's first
# apply). Reference them by data source rather than `google_secret_manager_secret`
# resources — a resource + placeholder version (the proposal-renderer
# pattern) would be fine for a brand-new secret, but these already hold real
# values and a managed placeholder version risks clobbering them.

data "google_secret_manager_secret" "deploy_key" {
  secret_id = "community-drafter-deploy-key"
}

data "google_secret_manager_secret" "admin_token" {
  secret_id = "community-drafter-admin-token"
}

data "google_secret_manager_secret" "cookie_secret" {
  secret_id = "community-drafter-cookie-secret"
}

resource "google_secret_manager_secret_iam_member" "deploy_key_accessor" {
  secret_id = data.google_secret_manager_secret.deploy_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_token_accessor" {
  secret_id = data.google_secret_manager_secret.admin_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "cookie_secret_accessor" {
  secret_id = data.google_secret_manager_secret.cookie_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

# --- Google OAuth (optional) ---
#
# community-drafter-google-client-id/-secret don't exist yet. Only create
# them — with a placeholder version, per the proposal-renderer pattern —
# when the operator sets both tfvars. Until then `google_client_id_secret`
# and `google_client_secret_secret` below have zero instances and OAuth env
# wiring in cloudrun.tf is skipped entirely.
resource "google_secret_manager_secret" "google_client_id" {
  count     = var.google_client_id != null && var.google_client_secret != null ? 1 : 0
  secret_id = "community-drafter-google-client-id"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "google_client_id" {
  count       = length(google_secret_manager_secret.google_client_id)
  secret      = google_secret_manager_secret.google_client_id[0].id
  secret_data = var.google_client_id
}

resource "google_secret_manager_secret_iam_member" "google_client_id_accessor" {
  count     = length(google_secret_manager_secret.google_client_id)
  secret_id = google_secret_manager_secret.google_client_id[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret" "google_client_secret" {
  count     = var.google_client_id != null && var.google_client_secret != null ? 1 : 0
  secret_id = "community-drafter-google-client-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "google_client_secret" {
  count       = length(google_secret_manager_secret.google_client_secret)
  secret      = google_secret_manager_secret.google_client_secret[0].id
  secret_data = var.google_client_secret
}

resource "google_secret_manager_secret_iam_member" "google_client_secret_accessor" {
  count     = length(google_secret_manager_secret.google_client_secret)
  secret_id = google_secret_manager_secret.google_client_secret[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}
