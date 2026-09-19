---
status: done
depends: [api-core]
specs:
  - specs/api/admin-cli.md
pr: 12
---

# Plan: admin-cli

## Scope

`drafter-axi` in `packages/cli` (axi-sdk-js) covering every command in the CLI spec that `api-core` serves, and its packaging as the installable skill `skills/drafter-axi/` with the committed bundle, bash shim, SessionStart hook and generated SKILL.md, plus the CI drift gate. `api-core` (merged in PR #10) already served every endpoint the CLI spec's table names, including `people remind` and `notifications *`, so all of it shipped in this plan with nothing deferred. Out: the API itself.

## Implements

- `specs/api/admin-cli.md` — all sections.

## Approach

1. Load `axi-skills` and the user-level `axi` skill. Scaffold from the `axi-skills` templates: `scripts/build-cli.ts` → committed `skills/drafter-axi/scripts/drafter-axi.mjs`, shim, `skill.ts` generating SKILL.md from the single-source command reference.
2. Commands as thin typed clients over `apps/api`'s admin routes; TOON output, `--json`; exit codes per spec; every mutation prints key fields and the commit subject returned by the API (add `commit` to admin write responses if missing, via a spec-conformant field).
3. Home view: documents with phase, next deadline, funnel counts, failures; `help[]` suggestions.
4. SessionStart hook prints the home view when `DRAFTER_URL` is set.
5. Install test: `npx skills add <this repo> --skill drafter-axi` into a scratch repo and run `drafter-axi` against a local API.

## Validation

- [x] `drafter-axi` with no args against a local instance prints the home view in TOON with `help[]`.
- [x] `docs create` → `versions publish` → `docs open` → `people import` → `people links` round-trips against a local API and the resulting data repo contains the expected commits with trailers.
- [x] `versions publish --dispositions` with an unknown `submission:comment` ref exits 2 with the API's message.
- [x] `people list` output contains no token and no email unless `--contacts`.
- [x] The committed bundle matches a fresh build (CI drift gate fails when it does not).
- [x] Installing the skill into a scratch repo with `npx skills add` yields a working `drafter-axi` and the SessionStart hook fires.

## Risks / unknowns

- **Skill install from a repo path** — `npx skills add JarvusInnovations/community-drafter --skill drafter-axi` depends on the repo layout the skills tool expects (`skills/<name>/SKILL.md`); confirm before choosing the directory name.
  - Resolved: confirmed against this branch via `npx -y skills add <local-path> --skill drafter-axi -y --agent claude-code universal` (the local-path form, since the branch isn't on `develop` yet) — installs to `.agents/skills/drafter-axi` with a `.claude/skills/drafter-axi` symlink, shim executable, bundle runs under plain `node`.

## Notes

- The admin API's routes are all under `/admin/api/*`; the CLI's `DrafterClient` bakes that prefix in once (`client.ts`), so every command module's `path` argument is written relative to it (`/documents`, not `/admin/api/documents`) — worth knowing before adding a new command.
- `people links`' response is CSV (the route's documented shape), which has nowhere to carry the `commit` field the other admin write responses now return (see the `fix(api)` commit) — left uncommented in the CLI, noted in the API route.
- `home`'s invited/opened/signed/failure funnel counts aren't in the bulk `GET /documents` response, so `home` does a bounded (top 10, nearest-deadline-first) fan-out of `invitations` + `notifications` calls for *open* documents only, to stay cheap enough for a SessionStart hook. Revisit if the number of concurrently open documents on a real instance grows large enough to matter.
- Discovered mid-implementation: Node/Bun's `process.exitCode`, once set to a number, silently ignores a later assignment of `undefined` (the value just stays). Only bites a test harness that reuses one process across multiple CLI invocations (`packages/cli/src/e2e.test.ts`); resets with `0` instead. A real CLI invocation is a fresh process each time, so this doesn't affect production behavior — flagging in case it trips up a future test.

## Follow-ups

- Issue [#13](https://github.com/JarvusInnovations/community-drafter/issues/13) — `people expire` (the API's `POST .../invitations/:person/expire`) isn't in `specs/api/admin-cli.md`'s command table and so isn't wired into the CLI; unclear whether that's an intentional scope cut or an oversight in the CLI spec.
