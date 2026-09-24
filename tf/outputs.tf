output "service_url" {
  description = "Cloud Run *.run.app URL (use until the drafter.jarv.us domain mapping is verified)"
  value       = google_cloud_run_v2_service.community_drafter.uri
}

output "github_actions_service_account" {
  description = "Service account the publish workflow assumes via Workload Identity Federation"
  value       = google_service_account.github_actions.email
}

output "workload_identity_provider" {
  description = "Full resource name to pass as workload_identity_provider in google-github-actions/auth"
  value       = google_iam_workload_identity_pool_provider.github_actions.name
}
