# Operator-facing values so a bare `tofu apply -concise` never regresses the
# running service. Update image_tag on every manual deploy (or pass -var).
image_tag                = "sha-031a91e"
public_url               = "https://drafter.jarv.us"
mailer                   = "postmark"
bootstrap_operator_email = "chris@jarv.us"

# Raised for the simulated campaign run of 2026-09-20 (many operators signing in from one machine); return to 5 afterwards.
auth_login_rate_limit = 500
