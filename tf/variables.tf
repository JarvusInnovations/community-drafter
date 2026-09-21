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

variable "site_hostnames" {
  description = "Customer site hostnames, each already verified to the Google identity that runs this apply; every entry gets its own Cloud Run domain mapping (specs/behaviors/sites.md § Onboarding a hostname; docs/operations.md step 7). An unverified hostname fails the apply, so verification comes first."
  type        = list(string)
  default     = []
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

# --- Operators (specs/behaviors/operators.md) ---
#
# The only way the first operator comes into existence: set on the first
# apply against a fresh data repo (empty `operators` sheet), then safe to
# leave set or clear on later applies — the storage layer only bootstraps
# once the sheet is non-empty (`plans/operators-auth.md`).
variable "bootstrap_operator_email" {
  description = "Email of the first operator, created at boot when the operators sheet is empty (null skips bootstrap entirely)"
  type        = string
  default     = null
}

variable "auth_login_rate_limit" {
  description = "Sign-in requests allowed per address and per source IP per 15 minutes (specs/api/auth.md; AUTH_LOGIN_RATE_LIMIT). Raise only for test runs that sign many operators in from one machine."
  type        = number
  default     = 5
}

variable "platform_hostname" {
  description = "The platform's own hostname for the running app (the default site). Mapped to the Cloud Run service; its apex A/AAAA records are derived from the mapping. null to skip."
  type        = string
  default     = "signatories.app"
}
