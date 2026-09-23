# Architecture

Foundational technical decisions. These are concrete choices, distinct from the value judgments in `principles.md`. The stack follows the Jarvus house skills vendored in `.agents/skills/` (`jarvus-fastify`, `jarvus-react`, `ci-quality-gates`, `repo-setup`, `release-flow`, `axi-skills`); departures from them are called out explicitly below so nobody re-litigates them by accident.

## Shape

A single-instance service made of:

- an **API server**: Fastify 5 on Bun, TypeScript run directly, per `jarvus-fastify`;
- a **web app**: React 19 + Vite + Tailwind CSS v4 + React Router v7, per `jarvus-react`, built to static assets that the API server serves;
- a **data repository**: a private git repo of gitsheets records that is the only durable store;
- an **admin CLI**: an AXI-style command-line tool over the admin API. Its **primary distribution is a skill with the CLI bundle embedded** (a committed self-contained `.mjs` under the skill's `scripts/`, per `axi-skills`), installed into an adopting team's repo with `npx skills add`, where that team's own agent drives it. It is not an npm-distributed package;
- **outbound messaging** through a provider adapter (email now, SMS **[phase 2]**).

There is no database. That is the one large departure from the house backend skill and it is deliberate (see *Storage*).

## Runtime and tooling

- Bun for runtime, package management, scripts and tests; `asdf` pins it in `.tool-versions`. No Node toolchain unless the CLI is later published to npm.
- TypeScript everywhere; `tsc` for type checking only.
- Lint/format/typecheck/test gates per `ci-quality-gates` (oxlint, oxfmt); repo bootstrapped per `repo-setup` (develop → main, merge commits); releases per `release-flow`.
- Monorepo layout with Bun workspaces: `apps/api`, `apps/web`, `packages/cli`, `packages/shared` (types, anchor/diff algorithms shared by API and web).

## Storage: the data repository

One private git repository, configured by URL and branch, holds every durable fact as **gitsheets** records (four flat sheets, `data-model.md`). **Commits are the data model**: a record is the current state of one thing, and every change is a commit whose trailers carry the structured facts (`Action`, `Document`, `Person`, `Version`, `Judgement`, `Summary`, …). Time, history, versions and activity are read from `git log`, never duplicated into records. The API server clones the repo at boot over SSH with a deploy key and is the **single writer**; the gitsheets push daemon pushes each commit to the remote.

- All writes go through `repo.transact`. One user-significant action is one commit with a human-readable subject (`sign: jane-doe on coalition-charter`, `publish: coalition-charter v3`, `submit: jane-doe on coalition-charter v2 (sign_conditional)`) and the trailer set defined in `data-model.md`.
- **Immediate commits** for: document create/update, publish, invitation creation, submission, sign, revoke, decline, preference changes, notification send batches (one commit per batch, patching `participations.notified`), admin schedule changes.
- **Immediate, durable-before-acknowledge commits** also for every comment saved into a draft submission: the participant API responds only once the item is committed. Typing itself never hits the server (it is buffered in the browser), so this is one commit per finished comment, a human-rate event.
- **Batched commits** (write-behind, at most every 60 seconds and on shutdown) only for open/seen tracking on participations (`Action: track`). A crash loses at most one interval of open counts, nothing else.
- An in-memory read model is built at boot from the four sheets **plus one pass over `git log` with trailers** (version index per document from body-changing commits, sign/revoke dates per participation, save/submit dates per submission, latest position per person, recent activity), indexed by token, and updated on every write. The request path never shells out to git; older content bodies are read once per commit and cached.
- **Versions are git.** Each document is one markdown record: settings in frontmatter, text as body. Its body-changing commits are the versions (`data-model.md`). The read model indexes them with `git log --first-parent` over that path at boot, appends on publish, and reads an older body with `git show <commit>:<path>`. Version bodies and rendered HTML are cached in memory per commit.
- gitsheets markdown normalization is **on** for version bodies so diffs reflect wording rather than formatting (decided 2026-09-19; the publisher is warned that authored line breaks and list markers are canonicalized).
- Contact details live in the data repo, which is private. Tokens are never returned by the admin API after creation except through the explicit links export.

**Departure from `jarvus-fastify`:** the skill's auth reference assumes a database-backed token store. Here the **participations sheet is the token store** for participant credentials (revocable per row, exactly the property the skill wants), and operator sessions are **stateless signed tokens** whose authority is re-read from the `operators` sheet on every request, so revocation is a record change and nothing about sessions needs persisting. Magic-link nonces and pending device codes are short-lived in-memory state whose loss on restart only costs a retry. Adding a database for this would contradict [The record is a git repo](principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app).

## API server

- Fastify 5 with `@fastify/env` for configuration, deny-by-default auth gateway per the house pattern: every route declares a capability; undeclared fails closed.
- Capabilities: `participant` (token from the `/i/:token` path segment resolves to a participation and becomes `request.principal`), `operator` (a signed token from the session cookie or `Authorization: Bearer`, resolved to an active operator record; document routes additionally check membership), `webhook` (HMAC signature for `refresh`), `public` (enumerated anonymous routes: `/d/:slug/*`, `/auth/*`, health, SPA shell and assets).
- Serves the built web app (`@fastify/static`) with SPA fallback for `/i/*`, `/d/*`, `/admin/*`.
- Renders markdown to HTML server-side through a **unified** pipeline (`remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-slug`, `rehype-sanitize`, `rehype-stringify`) plus the project's **block identity** plugin (`behaviors/inline-comments.md`). Rendered HTML per version is cached in memory. Diffs between versions are computed server-side (`behaviors/versioning.md`).
- **The deliverable is rendered in-process by headless Chromium** (`screens/deliverable.md`). The server builds a standalone print document — the version's already-rendered, already-sanitized HTML inside a title block, a signatory list and a print stylesheet — and drives a system Chromium over the DevTools protocol (`puppeteer-core`, no bundled browser download) to turn it into a PDF. One browser process, launched lazily on the first render, shared by every render, serialized to one page at a time, and shut down after an idle period so an instance that never serves a PDF pays nothing for it beyond the bytes in the image. Renders are cached in memory by document, version commit and a hash of the signatory list, with a short lifetime and a small bound; **no PDF is ever written to the data repo**. Chromium and its fonts are installed from Debian's own packages in the `Dockerfile`; nothing downloads a browser at build or run time, and the executable is found at `CHROMIUM_PATH` or at the usual Debian locations.
- Background work (notification dispatch with retries, the daily operator digest, phase-transition observation, batched flushes) runs in-process on timers; single instance makes this safe. The dispatch queue and its failures are in memory and in logs, not in the record; idempotency comes from `participations.notified`, so a restart can safely re-derive what still needs sending.

## Web app

- One React SPA with three route families: `/i/:token/*` (participant), `/d/:slug/*` (public and embeds), `/admin/*` (dashboard).
- The document body arrives from the API as sanitized HTML and is injected into the page; React owns everything around it. Selection capture, anchor computation and highlight placement are framework-agnostic DOM code in `packages/shared`, invoked from a hook, so the same code runs in the admin view and could run in a non-React embed.
- Tailwind v4 with semantic tokens; no shadcn unless a later plan adopts it. Phone width is the primary layout.
- Bundle budget for the participant entry: under 120 KB gzipped JS on first load, measured in CI, because [Sign first](principles.md#sign-first-everything-else-after) is a latency promise too.

**Departure from `jarvus-react`:** none in stack. One constraint the skill does not impose: participant routes must not *depend* on cookies or local storage to function, because personal links are opened in email webviews and iframes where both may be blocked. Local storage is used, when available, only as the best-effort typing buffer described in `behaviors/review-and-judgement.md`; when it is unavailable the buffer is in memory and the per-item durable saves still hold.

## Authentication

| Principal | Credential | Scope |
| --- | --- | --- |
| Participant | opaque token in the URL path (`/i/<token>`) | one invitation: one person on one document |
| Operator (human) | magic-link sign-in → 24 h signed session cookie, CSRF header on writes | dashboard and admin API, scoped to their documents |
| Operator (CLI or bot) | 90-day signed token from the device-code flow, `Authorization: Bearer` | admin API, scoped to their documents |

Operators are records in the `operators` sheet; authorization is read from that record and from `documents.operators` on every request, never from token claims (`behaviors/operators.md`). There is no instance-wide credential; the first operator is created at boot from `BOOTSTRAP_OPERATOR_EMAIL` when the sheet is empty.

Participant tokens: random, at least 96 bits, base62, unique across the instance, constant-time compared. Unknown, revoked and expired tokens yield the same "link unavailable" response. **[phase 2]** public sign-in via emailed magic links that mint a normal invitation.

## Outbound messaging

A `Mailer` interface with implementations selected by configuration: **Postmark** (recommended; the operator already holds an account), SMTP fallback, and **export**, which writes a CSV of `name,email,subject,link` for mail-merge through a marketing tool such as Kit. **[phase 2]** `SmsSender` with Twilio. Templates live in the repo; every send is a `notifications` record.

## Deployment

- Container from `oven/bun` (Debian variant) with `git`, `openssh-client` and **`chromium`** (Debian's package, with the font packages it needs to set Latin text); deploy key mounted from Secret Manager; entrypoint clones the data repo then starts the API server (the proposal-renderer `entrypoint.sh` pattern). Chromium is the largest single thing in the image and it is there for one feature — the deliverable — which is the artifact the whole service exists to produce; a second service just to print it would need its own copy of the record.
- **Cloud Run**, `max_instance_count = 1` (load-bearing: single writer), `min_instance_count = 1` (no cold clone on a participant's first click; smaller batched-write loss window), SIGTERM handler flushes batched writes and drains the push daemon.
- OpenTofu under `tf/` following proposal-renderer's layout (Cloud Run, Artifact Registry, Secret Manager, service accounts, domain mappings — one for the deployment's own hostname and one per site hostname). Image build and `tofu apply` from GitHub Actions on release tags per `release-flow`. A pull request that changes `tf/` is gated before it merges by formatting and validation, with no credentials at all. A **read-only `tofu plan -concise`** against the real state belongs in the same gate — a typo or an unintended replacement should be read in review, not during a deploy — and runs under a **second, read-only service account** of its own: viewer roles on the resources the refresh reads and object *read* on the state prefix, nothing that can change anything. The account that deploys holds admin roles because an apply needs them, and a gate that runs on every pull request has no business holding them: a plan that authenticates as the deploy account is one typo in a workflow away from being an apply. CI runs `apply` nowhere but the release workflow, and only that workflow uses the deploy account.
- Configuration (validated at boot by `@fastify/env`): `DATA_REPO_URL`, `DATA_REPO_BRANCH`, `DATA_REPO_WEBHOOK_SECRET`, `PUBLIC_URL`, `AUTH_SECRET` (signs sessions, CLI tokens and magic links), `BOOTSTRAP_OPERATOR_EMAIL`, `MAILER`, provider keys, `INSTANCE_NAME`, `INSTANCE_FROM_EMAIL`, `INSTANCE_TIMEZONE`, `CHROMIUM_PATH` (optional; the PDF renderer probes the usual Debian locations when it is unset). These last three, with `PUBLIC_URL`, are the **default site** — the identity of documents that name no site and of requests to unmapped hosts (`behaviors/sites.md`).

## Sites: many hostnames, one service

One deployment answers on many hostnames, and a **site** record binds a hostname to the identity every document assigned to it carries (`behaviors/sites.md`). The platform itself is **Signatories** at `signatories.org`, which is the default site; customer hostnames CNAME to `sites.signatories.org`, an alias in that same zone. Every request resolves to a site from its `Host` before routing; everything that read `PUBLIC_URL` or `INSTANCE_NAME` reads the resolved site instead, and every link is built on the *document's* site rather than the requesting host. The routing itself is **Cloud Run domain mappings**, one per hostname, declared in `tf/` as a `for_each` over a list variable — deliberately not a load balancer, whose cost and moving parts buy nothing at this scale, and deliberately not something the API can change: a domain must be verified — to the Google identity that creates the mapping, not merely to the project — before a mapping exists, and DNS and certificates stay out of reach of the service's credentials. Mail stays on one provider account and one API key: a site sends From its own verified address when it has one, otherwise from the platform's address under the site's name. The ceiling on onboarding is certificates rather than mappings: Google issues at most 50 per top domain per week and each takes minutes to appear, so a batch of whitelabel hostnames under one platform domain is rate-limited where the same batch spread across customers' own domains is not.

## Repository layout

```
specs/                 desired state
plans/                 work DAG
apps/api/              Fastify server: routes, gateway, storage, rendering, mail, jobs
apps/web/              React SPA
packages/shared/       types, anchor + diff algorithms, block-id hashing
packages/cli/          the admin AXI CLI source (axi-sdk-js)
skills/signatories-axi/    the installable skill: SKILL.md, shim, committed bundled .mjs, SessionStart hook
tf/                    OpenTofu
scripts/               entrypoint and operational scripts
.gitsheets/            sheet configs, copied into the data repo on init
```

## Non-goals

- Multi-instance or horizontal scale.
- Real-time collaborative editing; the team edits offline or through an agent and publishes versions.
- Running the LLM revision loop inside the service; it exports feedback and ingests versions. The agent that does the thinking lives in the adopting team's repo and reaches this service through the skill.
- A general CMS or petition platform.
