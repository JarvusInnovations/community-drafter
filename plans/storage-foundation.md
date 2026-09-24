---
status: done
pr: 5
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

- [x] `init-data-repo` against an empty bare repo yields the four committed sheet configs and `gitsheets-axi query documents` works against it.
- [x] A `publish` commit followed by a settings-only commit yields exactly one new version in the read model; a body change yields one more.
- [x] Every commit made through the wrapper carries `Action`, `Actor`, `Request-Id` and the action-specific trailers from `data-model.md`, verified with `git interpret-trailers --parse`.
- [x] Open tracking survives a SIGTERM (flushed) and never produces more than one commit per minute under a synthetic load of 100 opens.
- [x] Read model rebuilt from a repo with 3 documents, 50 participations, 20 submissions and 5 versions matches a golden JSON fixture.
- [x] The push daemon pushes each commit to the remote within 10 s in a local two-repo test.

## Risks / unknowns

- **Body-change detection cost** — comparing bodies across the whole history on every boot; acceptable at pilot scale, cache the version index in memory and consider a lightweight on-disk cache if boot exceeds 5 s.
- **gitsheets markdown normalization** — confirm `normalize = true` re-serializes unchanged bodies byte-identically so settings patches never register as versions.

## Notes

- **`init-data-repo` verified with the human `gitsheets` CLI, not `gitsheets-axi`.** Using the already-installed `gitsheets` binary (a project dependency) instead of `npx -y gitsheets-axi` avoids a network-dependent fetch in the test suite; both wrap the same library and config format, so this verifies the same thing the criterion asks for.
- **No new env var for the data repo's local clone directory.** `specs/architecture.md`'s Configuration list is `DATA_REPO_URL`/`DATA_REPO_BRANCH` only. The storage plugin defaults the local working copy to `apps/api/data/repo` (gitignored) and accepts a `dataDir` plugin option — that option, not an env var, is how tests point it at temp fixtures.
- **Zod fields with a `.gitsheets/*.toml` JSON Schema default are declared `.optional()`, not `.default()`.** JSON Schema validates (and fills defaults) before the Standard Schema layer runs, and `Store<V>`'s inferred record type is the schema's *output* type — a Zod `.default()` field is non-optional there, which would force every `upsert()` call site to restate e.g. `tags: []`. Noted inline in each schema file.
- **Anchor shape collision with the concurrently-merged `render-and-diff` plan.** Rebasing onto `develop` after `render-and-diff` merged (PR #4) surfaced that its `packages/shared/src/anchor/types.ts` already exports a canonical `Anchor` interface for the exact same shape `specs/behaviors/inline-comments.md` describes. `records/submissions.ts`'s `AnchorSchema` was tightened to match that interface's field optionality exactly (`heading_path`/`prefix`/`suffix` required, not optional) and no longer exports a type named `Anchor`, so the shared package's barrel (`export *` from both `anchor/index.ts` and `records/index.ts`) doesn't collide. `.gitsheets/submissions.toml`'s anchor sub-schema was updated the same way.
- **The read model does one repo-wide `git log --first-parent` pass, not one per record.** The original per-entity, path-scoped design (one `git log -- <path>` per document/participation/submission) turned out to under-deliver `specs/screens/admin-dashboard.md`'s "recent activity: the last 50 commits on this document" — a `sign`/`comment`/`submit` commit carries its document's `Document` trailer but never touches `documents/<slug>.md`, so it was silently missing from that document's activity. The fix (bucket a single whole-repo log by trailer instead of by path) is also strictly faster: one `git log` spawn total instead of one per entity, with an immutable `<hash>:<path>` body cache so repeated refreshes only pay for genuinely new commits.

## Follow-ups

None.
