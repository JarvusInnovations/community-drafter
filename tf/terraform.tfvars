# Operator-facing values so a bare `tofu apply -concise` never regresses the
# running service. Update image_tag on every manual deploy (or pass -var).
image_tag                = "sha-4d6fa93"
public_url               = "https://drafter.jarv.us"
mailer                   = "postmark"
bootstrap_operator_email = "chris@jarv.us"

# Raised for the simulated campaign run of 2026-09-20 (many operators signing in from one machine); return to 5 afterwards.
auth_login_rate_limit = 500

# Customer site hostnames, one Cloud Run domain mapping each (docs/operations.md
# step 7). Empty until the first customer is onboarded; pinned here so a bare
# `tofu apply -concise` never drops a mapping that a -var once added.
site_hostnames = ["demo.signatories.app"]
