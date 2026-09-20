# Operator-facing values so a bare `tofu apply -concise` never regresses the
# running service. Update image_tag on every manual deploy (or pass -var).
image_tag                = "sha-0248772"
public_url               = "https://drafter.jarv.us"
mailer                   = "postmark"
bootstrap_operator_email = "chris@jarv.us"
