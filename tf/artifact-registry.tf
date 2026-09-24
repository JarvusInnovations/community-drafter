resource "google_artifact_registry_repository" "community_drafter" {
  location      = var.region
  repository_id = "community-drafter"
  format        = "DOCKER"
  description   = "Docker images for community-drafter"

  depends_on = [google_project_service.artifactregistry]
}
