---
status: done
pr: 3
depends: []
specs:
  - specs/architecture.md
---

# Plan: workspace-bootstrap

## Scope

The repository shell the other plans build inside: Bun workspaces (`apps/api`, `apps/web`, `packages/shared`, `packages/cli`), TypeScript configs, the oxlint/oxfmt/typecheck/test scripts, and the pre-merge CI gates. No product code. Out: the release-publish artifact workflow (→ `deploy`), the data-repo sheet configs (→ `storage-foundation`).

## Implements

- `specs/architecture.md` — *Runtime and tooling*, *Repository layout*.

## Approach

1. Load `jarvus-fastify`, `jarvus-react` and `ci-quality-gates`; follow their setup guides rather than improvising.
2. Root `package.json` with Bun workspaces; `apps/api` scaffolded per `jarvus-fastify` (Fastify 5, `@fastify/env`, pino-pretty, `tsc --noEmit`); `apps/web` per `jarvus-react` (Vite, React 19, Tailwind v4, React Router v7, `tsc -b`); `packages/shared` and `packages/cli` as empty typed packages.
3. oxlint + oxfmt configs from `ci-quality-gates` templates (base + react); scripts `lint`, `format`, `format:check`, `typecheck`, `test` at root fanning out to workspaces. Run `bun run format` once and commit before any code.
4. GitHub Actions from the `ci-quality-gates` templates: setup-asdf composite, lint/typecheck/test on PRs to `develop`, path-filtered. Confirm action versions via `gh-axi repo view` READMEs.
5. `.env.example` enumerating every variable `architecture.md` lists, so `@fastify/env` and the example stay in lockstep.

## Validation

- [x] `bun install --frozen-lockfile` succeeds from a clean clone with only `.tool-versions` tooling.
- [x] `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test` all pass at root (test may be an empty suite that runs, not a no-op script).
- [x] CI runs those four gates on a PR to `develop` and is green on this plan's PR.
- [x] `apps/api` boots with `bun run dev` and answers `GET /_health`; `apps/web` builds with `bun run build`.
- [x] `.env.example` lists every configuration variable named in `specs/architecture.md`.

## Risks / unknowns

- **Template drift** — the house templates may assume a single-package repo; workspace fan-out of scripts needs checking against `ci-quality-gates`' path-scoping rule.

## Notes

- **Fan-out shape**: `depends: []` and no cross-package imports yet, so root scripts fan out via `bun run --filter='*' <script>` rather than project references / `tsc -b` at the root; each package's own `typecheck` is `tsc -b` (composite, self-contained). Revisit if a later plan wires `packages/shared` into `apps/api`/`apps/web` as an actual TS project reference.
- **CI gate shape**: lint/format:check/typecheck ride as three steps of one `oxc (<package>)` job per package in `lint.yml`; `test` (plus a web-only `vite build`) is its own job per package in `test.yml`. Not four separately-named checks, but all four gates run and are enforced.
- **Action versions confirmed, not copied from the templates**: `actions/checkout@v7` and `actions/cache@v6` (`ci-quality-gates`' templates pin v6/v5 respectively, one major behind at the time of writing) via `gh-axi release list -R <repo>` + `git ls-remote --tags` for the floating major ref; `asdf-vm/actions@v4` matched.
- **`bun add typescript` resolved TypeScript 7** (native/Go compiler), not 5.x. It removed the `baseUrl` compiler option entirely (TS5102) — `apps/web/tsconfig.app.json` uses a bare `paths` map instead. Everything else in the jarvus-fastify/jarvus-react tsconfig templates worked unchanged.
- **oxlint 1.83.0's react rule names differ from the `ci-quality-gates` `oxlintrc.react.json` template**: rules live under `react/*`, not `react-hooks/*` (renamed `rules-of-hooks`/`exhaustive-deps` accordingly), and there is no `react/react-compiler` rule in this version at all (closest schema entries are `react/purity`, `react/preserve-manual-memoization`, `react/static-components` — not substituted, since none is a direct equivalent).
- **No `@fastify/cors`**: nothing in this plan's scope crosses origins (only `GET /_health`), and the Vite dev proxy (`apps/web/vite.config.ts`) keeps local dev same-origin from the browser's perspective too. Add it if/when a future plan introduces a genuine cross-origin consumer.

## Follow-ups

- Tracked as: watch oxlint for a `react-compiler`-equivalent rule (or confirm `react/purity`/`react/static-components`/`react/preserve-manual-memoization` as the intended replacement) and re-add it to `apps/web/.oxlintrc.json`.
- Deferred to [`api-core`](api-core.md) — migrate `apps/api`'s deprecated `disableRequestLogging` Fastify option to `logController`/`isLogDisabled` while rewiring the gateway (absorbed into that plan's Approach/Validation in this same commit).
- Deferred to [`notifications`](notifications.md) — confirm the mailer provider-key environment variable names (`POSTMARK_API_KEY`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`) against the actual `Mailer` implementation and reconcile `.env.example` + `apps/api/src/plugins/env.ts` if they differ (absorbed into that plan's Approach/Validation in this same commit).
