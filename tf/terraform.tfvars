# Operator-facing values so a bare `tofu apply -concise` never regresses the
# running service. Update image_tag on every manual deploy (or pass -var).
image_tag                = "sha-7caafb6"
public_url               = "https://signatories.app"
mailer                   = "postmark"
bootstrap_operator_email = "chris@jarv.us"
# Postmark-verified sender on the platform domain (DKIM, Return-Path and DMARC in dns.tf).
instance_from_email = "hello@signatories.app"

# Raised for the simulated campaign run of 2026-09-20 (many operators signing in from one machine); return to 5 afterwards.
auth_login_rate_limit = 500

# Customer site hostnames, one Cloud Run domain mapping each (docs/operations.md
# step 7). Empty until the first customer is onboarded; pinned here so a bare
# `tofu apply -concise` never drops a mapping that a -var once added.
site_hostnames = ["demo.signatories.app"]
