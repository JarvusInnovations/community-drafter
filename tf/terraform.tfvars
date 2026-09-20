# Operator-facing values so a bare `tofu apply -concise` never regresses the
# running service. Update image_tag on every manual deploy (or pass -var).
image_tag  = "sha-152f85d"
public_url = "https://drafter.jarv.us"
