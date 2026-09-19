#!/bin/sh
# community-drafter container entrypoint.
#
# Runs at container start:
#   1. Write the SSH deploy key mounted at /secrets/deploy-key/latest into
#      $HOME/.ssh, plus a known_hosts entry for github.com.
#   2. Set the git committer identity used for commits the service makes
#      (open-tracking flushes, etc.) — distinct from any per-signature
#      identity recorded inside the gitsheets records themselves.
#   3. exec the API. The storage plugin (apps/api/src/storage/repo.ts) does
#      the actual clone-or-open of DATA_REPO_URL/DATA_REPO_BRANCH on boot —
#      this entrypoint only prepares the environment the clone needs
#      (deploy key + git identity), so the same clone-or-open logic stays
#      correct standalone (dev, tests) and doesn't get duplicated here.
#
# Env vars (Cloud Run sets these from Secret Manager / plain env per tf/cloudrun.tf):
#   DATA_REPO_URL, DATA_REPO_BRANCH  — consumed by the storage plugin, not here
#   ADMIN_TOKEN, COOKIE_SECRET       — consumed by the API's env schema
#   PORT                             — Cloud Run sets this; forwarded to the API
# Plus, for this script specifically:
#   DEPLOY_KEY_PATH                  (defaults to /secrets/deploy-key/latest)

set -eu

DEPLOY_KEY="${DEPLOY_KEY_PATH:-/secrets/deploy-key/latest}"

# 1. SSH setup. The deploy key is mounted as a Secret Manager volume; copy it
# into $HOME/.ssh with the strict permissions ssh/git expect.
if [ -f "$DEPLOY_KEY" ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  # `cat` rather than `cp`: Cloud Run secret volumes can rotate the
  # underlying file mid-read. `cp` aborts with "replaced while being
  # copied" and exits non-zero; `cat` reads the open fd to completion
  # regardless of underlying-file replacement.
  cat "$DEPLOY_KEY" > "$HOME/.ssh/id_deploy"
  chmod 600 "$HOME/.ssh/id_deploy"
  cat > "$HOME/.ssh/config" <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile $HOME/.ssh/id_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  chmod 600 "$HOME/.ssh/config"
else
  echo "WARN: no deploy key at $DEPLOY_KEY — clone will fail unless DATA_REPO_URL is anonymously cloneable" >&2
fi

# 2. Committer identity for commits the service itself makes.
git config --global user.name "Community Drafter"
git config --global user.email "drafter@jarv.us"

# 3. Hand off to the API. Run from apps/api so the storage plugin's default
# data directory (process.cwd()/data/repo) resolves to apps/api/data/repo,
# matching its documented default. Cloud Run sets $PORT; forward it
# explicitly so behavior matches whether or not Cloud Run happens to set it
# (local `docker run`, etc.).
cd /app/apps/api
export PORT="${PORT:-8080}"
exec bun run src/index.ts
