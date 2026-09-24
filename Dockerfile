# community-drafter image — the single-writer Cloud Run service, scaled to zero when idle (specs/architecture.md § Deployment).
#
# Debian variant of the official Bun image (not -slim/-alpine/-distroless): we
# need `git` + `openssh-client` for the entrypoint's deploy-key clone of the
# private data repo, and Debian's apt makes that a one-line install. Pinned to
# the same bun version this repo's .tool-versions/asdf resolve locally.
FROM oven/bun:1.4.2

WORKDIR /app

# git: entrypoint clones/opens the data repo and the storage plugin shells out
# to it. openssh-client: SSH deploy-key auth to github.com. ca-certificates:
# HTTPS calls (Google OAuth token verification, etc.).
#
# chromium: the statement PDF (specs/screens/deliverable.md) is printed by a
# headless browser that puppeteer-core drives over the DevTools protocol.
# Debian's own package, so nothing downloads a browser at build or run time.
# The font packages come with it deliberately: --no-install-recommends means
# Chromium arrives with no fonts at all, and a container with no fonts prints
# a page of empty boxes rather than failing loudly. Inter travels inside the
# render itself; these are the fallback for anything it does not cover.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates \
      chromium fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Workspace manifests first so `bun install` layers cache across source changes.
# packages/cli's manifest is included only so the workspace glob resolves against
# the committed lockfile; its source isn't copied — the container never runs it.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/cli/package.json packages/cli/package.json

# Full install (devDependencies included) so apps/web's build tooling
# (vite, tsc) is present for the build step below.
RUN bun install --frozen-lockfile

# Source for the pieces the container actually runs: the API, the shared
# package it imports, and the web app it builds to static assets.
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/
COPY packages/shared/ packages/shared/
# The sheet configs the API syncs into the data repo at boot (storage/init.ts).
COPY .gitsheets/ .gitsheets/

# Build the web app to static assets the API will serve.
RUN cd apps/web && bun run build

# Re-install production-only: prunes devDependencies (vite, tsc, oxlint, …)
# now that the web build artifact (apps/web/dist) is already on disk and
# independent of node_modules.
RUN bun install --frozen-lockfile --production

COPY scripts/entrypoint.sh /usr/local/bin/community-drafter-entrypoint
RUN chmod +x /usr/local/bin/community-drafter-entrypoint

ENV NODE_ENV=production
ENV PORT=8080
# Named rather than probed, so a change to Debian's layout is a build-time
# fact rather than a runtime surprise (specs/architecture.md § Configuration).
ENV CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/community-drafter-entrypoint"]
