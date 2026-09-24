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

# Search Console domain-property verification for signatories.app, so Cloud
# Run domain mappings under it can be created by the verified owners (the
# operator's account and the CI service account; docs/operations.md step 7).
resource "google_dns_record_set" "signatories_app_site_verification" {
  name         = google_dns_managed_zone.signatories_app.dns_name
  managed_zone = google_dns_managed_zone.signatories_app.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"google-site-verification=zEAZPNI0KjeYt81Ux_E4tIQSMGFOYMnrYOdNWPwPtIo\""]
}

# Same for signatories.org.
resource "google_dns_record_set" "signatories_org_site_verification" {
  name         = google_dns_managed_zone.signatories_org.dns_name
  managed_zone = google_dns_managed_zone.signatories_org.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"google-site-verification=F2ZwTZ9xmDeJS_g6X9AaWyWb63Qdf2D727kYu50iuVw\""]
}

# The product site (specs/screens/marketing-site.md) is GitHub Pages with
# signatories.org as its custom domain: apex A/AAAA to GitHub's Pages
# addresses, www as a CNAME to the org's Pages host. GitHub issues the
# certificate once these resolve.
resource "google_dns_record_set" "signatories_org_apex_a" {
  name         = google_dns_managed_zone.signatories_org.dns_name
  managed_zone = google_dns_managed_zone.signatories_org.name
  type         = "A"
  ttl          = 300
  rrdatas      = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"]
}

resource "google_dns_record_set" "signatories_org_apex_aaaa" {
  name         = google_dns_managed_zone.signatories_org.dns_name
  managed_zone = google_dns_managed_zone.signatories_org.name
  type         = "AAAA"
  ttl          = 300
  rrdatas      = ["2606:50c0:8000::153", "2606:50c0:8001::153", "2606:50c0:8002::153", "2606:50c0:8003::153"]
}

resource "google_dns_record_set" "signatories_org_www" {
  name         = "www.${google_dns_managed_zone.signatories_org.dns_name}"
  managed_zone = google_dns_managed_zone.signatories_org.name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["jarvusinnovations.github.io."]
}

# The app itself at the .app apex: A and AAAA records exactly as the Cloud
# Run domain mapping asks for them (an apex cannot CNAME).
locals {
  platform_records = var.platform_hostname == null ? [] : google_cloud_run_domain_mapping.platform[0].status[0].resource_records
  platform_a       = [for r in local.platform_records : r.rrdata if r.type == "A"]
  platform_aaaa    = [for r in local.platform_records : r.rrdata if r.type == "AAAA"]
}

resource "google_dns_record_set" "signatories_app_apex_a" {
  count        = var.platform_hostname == null ? 0 : 1
  name         = google_dns_managed_zone.signatories_app.dns_name
  managed_zone = google_dns_managed_zone.signatories_app.name
  type         = "A"
  ttl          = 300
  rrdatas      = local.platform_a
}

resource "google_dns_record_set" "signatories_app_apex_aaaa" {
  count        = var.platform_hostname == null ? 0 : 1
  name         = google_dns_managed_zone.signatories_app.dns_name
  managed_zone = google_dns_managed_zone.signatories_app.name
  type         = "AAAA"
  ttl          = 300
  rrdatas      = local.platform_aaaa
}

# Postmark sender-domain verification for signatories.app (the platform's
# default mail sender; specs/behaviors/sites.md § Mail): DKIM signing key
# and the custom Return-Path used for bounces. Values are Postmark's.
resource "google_dns_record_set" "signatories_app_postmark_dkim" {
  name         = "20260921030712pm._domainkey.${google_dns_managed_zone.signatories_app.dns_name}"
  managed_zone = google_dns_managed_zone.signatories_app.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"k=rsa;p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC8Tx+7uoF6DOSNcCACR72ktE1BcFqIBx8oVvuvLGq4BsA1KlwQ5eWaj7PUjK30XunDX+skXEQOM5UCivMF5AwQrVXDCw/dnZrqsA+wc3sqNrTYYfVjnrBWyGYs7r0uW50r2cp8KN5kKoDERqyN63cqGYY+C3nwv72SDWk+QsSr0wIDAQAB\""]
}

resource "google_dns_record_set" "signatories_app_postmark_return_path" {
  name         = "pm-bounces.${google_dns_managed_zone.signatories_app.dns_name}"
  managed_zone = google_dns_managed_zone.signatories_app.name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["pm.mtasv.net."]
}

# DMARC for signatories.app: monitor-only to start (p=none), aggregate
# reports to Postmark's DMARC digest service.
resource "google_dns_record_set" "signatories_app_dmarc" {
  name         = "_dmarc.${google_dns_managed_zone.signatories_app.dns_name}"
  managed_zone = google_dns_managed_zone.signatories_app.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"v=DMARC1; p=none; pct=100; rua=mailto:re+ywah5il5vup@dmarc.postmarkapp.com; sp=none; aspf=r;\""]
}
