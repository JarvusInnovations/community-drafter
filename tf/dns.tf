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

# The one name every customer hostname CNAMEs to (specs/architecture.md
# § Sites; specs/behaviors/sites.md § Onboarding a hostname, step 3). It is
# an alias for Google's Cloud Run endpoint, and customers are handed it
# instead of that endpoint so a change of target is one edit here rather
# than a request to every customer's DNS administrator — which is also why
# the TTL is low. Editing or deleting this record takes every whitelabel
# hostname down at once.
resource "google_dns_record_set" "sites_alias" {
  name         = "sites.${google_dns_managed_zone.signatories_org.dns_name}"
  managed_zone = google_dns_managed_zone.signatories_org.name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["ghs.googlehosted.com."]
}
