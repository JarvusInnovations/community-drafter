---
status: planned
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
- [ ] `bun install --frozen-lockfile` succeeds from a clean clone with only `.tool-versions` tooling.
- [ ] `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test` all pass at root (test may be an empty suite that runs, not a no-op script).
- [ ] CI runs those four gates on a PR to `develop` and is green on this plan's PR.
- [ ] `apps/api` boots with `bun run dev` and answers `GET /_health`; `apps/web` builds with `bun run build`.
- [ ] `.env.example` lists every configuration variable named in `specs/architecture.md`.

## Risks / unknowns
- **Template drift** — the house templates may assume a single-package repo; workspace fan-out of scripts needs checking against `ci-quality-gates`' path-scoping rule.

## Notes
(closeout)

## Follow-ups
(closeout)
