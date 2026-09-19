# Community Drafter

A single-instance service for community drafting and signing of collective
statements. See `CLAUDE.md` for conventions and `specs/README.md` for the
source of truth on what should be true of the running software.

## Workspace layout

Bun workspaces monorepo:

```
apps/api/       Fastify 5 API server
apps/web/       React 19 + Vite + Tailwind v4 + React Router v7 SPA
packages/shared/  types, anchor + diff algorithms shared by API and web
packages/cli/     source for the admin AXI CLI
```

## Getting started

```bash
bun install --frozen-lockfile

bun run lint          # oxlint, fanned out to every workspace
bun run format:check  # oxfmt --check, fanned out
bun run typecheck     # tsc -b, fanned out
bun run test          # bun test, fanned out

cd apps/api && cp ../../.env.example .env && bun run dev   # → GET /_health
cd apps/web && bun run dev                                 # → Vite dev server
```
