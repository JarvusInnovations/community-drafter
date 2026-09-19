---
status: planned
depends: [workspace-bootstrap]
specs:
  - specs/architecture.md
  - specs/data-model.md
---

# Plan: storage-foundation

## Scope
The data-repository layer: gitsheets sheet configs for the four sheets, the transaction wrapper that stamps trailers, the read model built from records plus `git log`, the version index derived from body-changing commits, the write-behind tracker for opens, the push daemon, boot-time clone, and the `init-data-repo` helper. Out: HTTP routes (→ `api-core`), rendering (→ `render-and-diff`).

## Implements
- `specs/data-model.md` — all four sheets, the trailer set, version derivation, position derivation.
- `specs/architecture.md` — *Storage: the data repository* (immediate vs batched commits, single writer, read model, push daemon).

## Approach
1. Load the `gitsheets` skill. Author `.gitsheets/{documents,people,participations,submissions}.toml` in this repo with JSON Schemas matching `data-model.md` (`documents` as markdown format with `body = 'body'`, no `title`); `init-data-repo` copies and commits them into an empty data repo.
2. `packages/shared`: Zod schemas for the four record types (Standard Schema) and a `Trailers` type; `apps/api/src/storage/` opens the repo with `openStore` and exposes `commit(action, trailers, fn)` wrapping `repo.transact` with author/committer from the actor and trailers appended.
3. Read model: load all records body-less, hydrate document bodies; one `git log --first-parent --format` pass with trailer parsing per document to build versions (compare body content between adjacent commits), sign/revoke dates, submission timing, latest positions, activity. Index participations by token. Update incrementally on every commit the service makes.
4. Tracker: in-memory open counts flushed at most every 60 s and on SIGTERM as a single `Action: track` commit.
5. `repo.startPushDaemon` against the configured remote; startup-backlog check logged.
6. Boot: clone via deploy key if the working directory is empty (entrypoint pattern), else open.

## Validation
- [ ] `init-data-repo` against an empty bare repo yields the four committed sheet configs and `gitsheets-axi query documents` works against it.
- [ ] A `publish` commit followed by a settings-only commit yields exactly one new version in the read model; a body change yields one more.
- [ ] Every commit made through the wrapper carries `Action`, `Actor`, `Request-Id` and the action-specific trailers from `data-model.md`, verified with `git interpret-trailers --parse`.
- [ ] Open tracking survives a SIGTERM (flushed) and never produces more than one commit per minute under a synthetic load of 100 opens.
- [ ] Read model rebuilt from a repo with 3 documents, 50 participations, 20 submissions and 5 versions matches a golden JSON fixture.
- [ ] The push daemon pushes each commit to the remote within 10 s in a local two-repo test.

## Risks / unknowns
- **Body-change detection cost** — comparing bodies across the whole history on every boot; acceptable at pilot scale, cache the version index in memory and consider a lightweight on-disk cache if boot exceeds 5 s.
- **gitsheets markdown normalization** — confirm `normalize = true` re-serializes unchanged bodies byte-identically so settings patches never register as versions.

## Notes
(closeout)

## Follow-ups
(closeout)
