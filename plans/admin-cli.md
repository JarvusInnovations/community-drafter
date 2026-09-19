---
status: planned
depends: [api-core]
specs:
  - specs/api/admin-cli.md
---

# Plan: admin-cli

## Scope
`drafter-axi` in `packages/cli` (axi-sdk-js) covering every command in the CLI spec that `api-core` serves, and its packaging as the installable skill `skills/drafter-axi/` with the committed bundle, bash shim, SessionStart hook and generated SKILL.md, plus the CI drift gate. Commands whose endpoints land later (`people remind`, `notifications *`) ship as soon as those plans merge, via follow-up. Out: the API itself.

## Implements
- `specs/api/admin-cli.md` — all sections.

## Approach
1. Load `axi-skills` and the user-level `axi` skill. Scaffold from the `axi-skills` templates: `scripts/build-cli.ts` → committed `skills/drafter-axi/scripts/drafter-axi.mjs`, shim, `skill.ts` generating SKILL.md from the single-source command reference.
2. Commands as thin typed clients over `apps/api`'s admin routes; TOON output, `--json`; exit codes per spec; every mutation prints key fields and the commit subject returned by the API (add `commit` to admin write responses if missing, via a spec-conformant field).
3. Home view: documents with phase, next deadline, funnel counts, failures; `help[]` suggestions.
4. SessionStart hook prints the home view when `DRAFTER_URL` is set.
5. Install test: `npx skills add <this repo> --skill drafter-axi` into a scratch repo and run `drafter-axi` against a local API.

## Validation
- [ ] `drafter-axi` with no args against a local instance prints the home view in TOON with `help[]`.
- [ ] `docs create` → `versions publish` → `docs open` → `people import` → `people links` round-trips against a local API and the resulting data repo contains the expected commits with trailers.
- [ ] `versions publish --dispositions` with an unknown `submission:comment` ref exits 2 with the API's message.
- [ ] `people list` output contains no token and no email unless `--contacts`.
- [ ] The committed bundle matches a fresh build (CI drift gate fails when it does not).
- [ ] Installing the skill into a scratch repo with `npx skills add` yields a working `drafter-axi` and the SessionStart hook fires.

## Risks / unknowns
- **Skill install from a repo path** — `npx skills add JarvusInnovations/community-drafter --skill drafter-axi` depends on the repo layout the skills tool expects (`skills/<name>/SKILL.md`); confirm before choosing the directory name.

## Notes
(closeout)

## Follow-ups
(closeout)
