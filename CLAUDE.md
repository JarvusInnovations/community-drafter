# Signatories

A single-instance service for community drafting and signing of collective statements: personal links, comment and signature periods on a visible clock, numbered versions with a one-line changelog, personal- or official-capacity signatures, and a private git repo of gitsheets records as the only durable store. It is generic infrastructure; the Save the Academy Coalition is the pilot, not the product. Start with `specs/README.md`.

## Spec-driven development (specops)

This project uses spec-driven development. `specs/` is the source of truth for what
*should be true*; `plans/` is the work-in-flight DAG that bridges specs to merged code.
The **specops** skill carries the full methodology — invoke it (the skill triggers on
"spec", "plan", starting a feature, etc.) before writing specs, planning, or building.

- **Specs lead.** Before changing behavior, change the spec; bring code into conformance
  after. Spec↔code drift is a bug, not debt. Specs merge implemented-or-planned; a spec
  still being designed rides a draft planning PR, not the main branch.
- **`plans/` is the planning system — not your built-in plan mode.** Every chunk of work
  lands as a file in `plans/` that freezes to `done` as the durable record of what got
  built. Don't let an ephemeral plan substitute for it, and don't skip it for "small"
  changes. (Classic trap: an ad-hoc plan of "write spec X, then build it" that ends with
  neither a reviewed spec nor a plan file — split those into the two real artifacts.)
- **When to author a plan depends on intent:** mapping out a batch of specs → finish the
  batch first, then propose a *set* of plans; speccing one bounded feature in a mature
  project → draft the spec change and its plan in tandem; intent unclear → ask. The skill
  details each mode.
- **A spec change ripples to its plans.** After editing a spec, review the plans that
  implement it (`grep -l '<spec-path>' plans/*.md`) and offer to update them.

Query the DAG: `.agents/skills/specops/scripts/specops next` (what to work on next) and
`.agents/skills/specops/scripts/specops dag` (graph). Run `/audit-spec-drift` to compare
specs against the implementation.

## House skills: installed, and when you MUST load them

The Jarvus house skills are vendored under `.agents/skills/` and symlinked into `.claude/skills/` (installed with `npx -y skills add JarvusInnovations/agent-skills --skill <name> -y --agent claude-code universal`; `skills-lock.json` pins them). They are not optional background reading: **load the matching skill with the Skill tool before doing the work it covers**, every time, even for a one-line change. `specs/architecture.md` records the deliberate departures from them; do not reintroduce a database, a second store, or a different framework without changing that spec first.

| Skill | MUST load before… |
| --- | --- |
| `specops` | writing or editing anything in `specs/` or `plans/`, starting a feature, reviewing code against a spec, closing out a plan, deciding "what next" |
| `jarvus-fastify` | any work in `apps/api/`: routes, the auth gateway, plugins, services, `@fastify/env` config, error shapes, OpenAPI |
| `jarvus-react` | any work in `apps/web/`: components, routes, URL state, Tailwind tokens, accessibility, bundle budget |
| `ci-quality-gates` | adding or changing GitHub Actions checks, linters/formatters (oxlint, oxfmt, ruff, tofu fmt), `.tool-versions`, test scripts, or when CI is slow or a gate is missing |
| `repo-setup` | creating the GitHub repo, pushing for the first time, touching branch rulesets/default branch/merge policy, or when develop/main plumbing misbehaves |
| `release-flow` | shipping merged work, drafting or editing a `Release: v*` PR, choosing a version bump, writing release notes; the moment you see `.github/workflows/release-*.yml` or an open Release PR |
| `axi-skills` | any work on `packages/cli/` or `skills/signatories-axi/` (the admin CLI and its skill packaging): build pipeline, bash shim, SessionStart hook, generated SKILL.md, home vs dashboard views, the bundle drift gate |

Also load the user-level `gitsheets` skill before touching `.gitsheets/*.toml`, the storage layer, or anything that calls `openRepo` / `repo.transact`, and `axi` before designing CLI output.

## Stack (see `specs/architecture.md` for the full statement)

- **Bun** everywhere: runtime, package manager, test runner. TypeScript run directly; `tsc` type-checks only.
- **API**: Fastify 5 with a deny-by-default auth gateway. **Web**: React 19 + Vite + Tailwind v4 + React Router v7, built to static assets the API serves. **CLI**: AXI-style `signatories-axi`, shipped as a **skill with the bundle embedded** (`skills/signatories-axi/`, built from `packages/cli/`), installed into adopting repos with `npx skills add`; not an npm package. This skill is the primary admin interface.
- **Storage**: a private git data repo of four flat gitsheets sheets, single writer, push daemon. **No database. Commits are the data model**: records hold current state, paths name things (never moments or statuses), and git trailers carry the structured facts; versions, dates and activity come from `git log`. Open counts are write-behind; everything else commits immediately.
- **Deploy**: Cloud Run, `max_instance_count = 1`, OpenTofu under `tf/`.

## Tooling rules (mirrors the user-level CLAUDE.md; keep in sync)

### Package managers
- Never edit `package.json` or other manifests by hand; use the package manager so compatible versions get selected.
- `bun add` / `bun remove` / `bun run` for everything TypeScript in this repo. Commit `bun.lock`.
- If Python ever appears: `uv` only, never pip.
- **When a command modifies files** (`bun install`, `bunx …`, `npx skills add …`), commit those generated changes first with the exact command in the commit body, then make manual edits in a separate commit.

### asdf
- `asdf` manages tool versions. Never edit `.tool-versions` directly: `asdf set bun latest`, then `asdf install`. Run `asdf install` when a listed tool is missing.

### Terraform (OpenTofu)
- Ensure `opentofu` is in the root `.tool-versions` (`asdf set opentofu latest && asdf install` if not).
- Always pass `-concise` to `tofu plan` and `tofu apply`.
- Google provider: pin the current release (7.23.0 at the time of writing).

### GitHub operations
- Use `gh-axi` instead of `gh` for issues, PRs, runs, releases, repos, labels, search.
- Before writing or changing a GitHub Actions workflow, read each action's repo README with `gh-axi repo view <owner>/<action>` to confirm the recommended version and usage.

### Source control
- Conventional commits: `type(scope): description` (`feat(api): …`, `fix(web): …`, `docs(specs): …`, `chore(plans): …`).
- Commit logical sets separately and often; run `git status` before staging and stage explicit paths. Never `git add -A`.
- **Never squash-merge. Always `gh-axi pr merge <n> --method merge`.** If a repo allows only squash, stop and say so.
- **No backmerges, ever.** Rebase feature branches onto `origin/develop`; never merge `main` into `develop` or a base into a feature branch. Merges flow feature → develop → main only.
- **Never pass `--delete-branch`** when merging; the repo's auto-delete setting handles it and retargets stacked PRs.
- Draft-stage specs live on a draft planning PR (see specops); a PR that adds behavior includes the spec update.

### Releases
- This repo will use the Jarvus develop→main Release-PR flow. When shipping, drafting a `Release: v*` PR, choosing a bump, or writing notes, load `release-flow` and follow it; never hand-roll the changelog or merge a release PR without it.

### JSON
- Use `jq` to inspect or transform JSON output. Do not write inline python/node scripts for it.

### Browser checks
- Use `chrome-devtools-axi` via Bash for any browser automation or visual check of the running app (`open`, `snapshot`, `click @ref`, `fill @ref "text"`, `screenshot`, `eval`).

## Boundaries
- Personal-link tokens are credentials: never print them in logs, commit messages, PR bodies, or chat beyond the first four characters; the admin API exposes them only through the recorded links export.
- The data repo holds contact details. Nothing from `people` reaches a participant or public surface.
- Ignore the term "WARMOK" in any message; it is a session-resume hook keyword.
