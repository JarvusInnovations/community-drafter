variable "project_id" {
  description = "GCP project ID hosting the community-drafter deployment"
  type        = string
  default     = "community-drafter"
}

variable "region" {
  description = "Default GCP region for Cloud Run + Artifact Registry"
  type        = string
  default     = "us-east4"
}

variable "image_tag" {
  description = "Container image tag for Cloud Run deployment (set by CI on release; the manual first deploy passes -var image_tag=sha-<short sha>)"
  type        = string
  default     = "latest"
}

variable "github_repo" {
  description = "GitHub repo (owner/name) allowed to assume the CI/CD service account via Workload Identity Federation"
  type        = string
  default     = "JarvusInnovations/community-drafter"
}

variable "data_repo_url" {
  description = "SSH URL of the private gitsheets data repo the container clones at startup"
  type        = string
  default     = "git@github.com:JarvusInnovations/community-drafter-data.git"
}

variable "data_repo_branch" {
  description = "Branch of the data repo the container reads from and pushes to"
  type        = string
  default     = "main"
}

variable "public_url" {
  description = "Public-facing base URL of the deployment. Empty until the first apply's service_url output (or the drafter.jarv.us domain mapping) is known; a second apply sets it."
  type        = string
  default     = ""
}

variable "domain_mapping" {
  description = "Custom domain to map to the Cloud Run service (null to skip)"
  type        = string
  default     = "drafter.jarv.us"
}

variable "instance_name" {
  description = "Display name for this instance (specs/architecture.md § Deployment → Configuration: INSTANCE_NAME)"
  type        = string
  default     = "Community Drafter"
}

variable "instance_from_email" {
  description = "From: address for outbound notifications (INSTANCE_FROM_EMAIL)"
  type        = string
  default     = "drafter@jarv.us"
}

variable "instance_timezone" {
  description = "IANA timezone governing the daily digest hour (INSTANCE_TIMEZONE)"
  type        = string
  default     = "America/New_York"
}

variable "mailer" {
  description = "Mailer backend: postmark | smtp | export"
  type        = string
  default     = "export"
}

# --- Google OAuth (optional — not configured yet) ---
#
# No community-drafter-google-client-id/-secret exist in Secret Manager yet.
# Leave both null (the default) to skip creating the secrets and wiring the
# env vars entirely; admin auth falls back to ADMIN_TOKEN only. Set both to
# turn OAuth on in a later apply.
variable "google_client_id" {
  description = "Google OAuth web client ID for admin-user sessions (optional; null skips OAuth entirely)"
  type        = string
  default     = null
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth client secret (optional; null skips OAuth entirely)"
  type        = string
  default     = null
  sensitive   = true
}

variable "oauth_allowed_emails" {
  description = "Comma-separated allowlisted admin emails (only used when Google OAuth is configured)"
  type        = string
  default     = ""
}

variable "oauth_allowed_domains" {
  description = "Comma-separated allowlisted admin email domains (only used when Google OAuth is configured)"
  type        = string
  default     = ""
}
