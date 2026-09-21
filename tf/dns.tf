# Public DNS zones for the platform's own domains (signatories.org and
# signatories.app), registered 2026-09-20. The registrar's name servers are
# pointed at the `name_servers` output of each zone. Records for the
# platform site and the whitelabel CNAME target (`plans/site-hostnames.md`)
# are added here as they are decided; nothing in these zones names a tenant.

resource "google_project_service" "dns" {
  service            = "dns.googleapis.com"
  disable_on_destroy = false
}

resource "google_dns_managed_zone" "signatories_org" {
  name        = "signatories-org"
  dns_name    = "signatories.org."
  description = "Platform domain: signatories.org"
  visibility  = "public"

  dnssec_config {
    state = "on"
  }

  depends_on = [google_project_service.dns]
}

resource "google_dns_managed_zone" "signatories_app" {
  name        = "signatories-app"
  dns_name    = "signatories.app."
  description = "Platform domain: signatories.app"
  visibility  = "public"

  dnssec_config {
    state = "on"
  }

  depends_on = [google_project_service.dns]
}

output "signatories_org_name_servers" {
  description = "Set these as the name servers for signatories.org at the registrar."
  value       = google_dns_managed_zone.signatories_org.name_servers
}

output "signatories_app_name_servers" {
  description = "Set these as the name servers for signatories.app at the registrar."
  value       = google_dns_managed_zone.signatories_app.name_servers
}
