---
status: done
depends: []
issues: []
pr: 104
specs:
  - specs/README.md
  - specs/architecture.md
  - specs/api/admin-cli.md
  - specs/api/auth.md
  - specs/behaviors/operators.md
  - specs/behaviors/sites.md
  - specs/screens/marketing-site.md
---

# Plan: rename-signatories

## Scope

The product is **Signatories**. Rename everything product-facing inside this repository, in one
pass, so that nothing a participant, an operator, or a visitor reads still says "Community
Drafter".

The app runs at `https://signatories.app` (already the `public_url`, already the mail domain);
the product site is `https://signatories.org` (already the Pages custom domain). Those two facts
are already true on `develop` — what is left is the *name*.

**In**, six areas:

1. **Names in the running app.** The instance/site name fallback (`apps/api/src/sites/site.ts`
   `FALLBACK_INSTANCE_NAME`), the admin copy default (`apps/web/src/admin/copy.ts` `siteName`),
   the SPA shell title and header (`apps/web/index.html`, `apps/web/src/App.tsx`), the sender
   fallback (`apps/api/src/notifications/sender.ts`), the internal actor and bootstrap addresses
   under `apps/api/src/storage/`, the health service label, the generic OG card
   (`apps/web/public/og.png` and its source `scripts/og-cards/instance-card.html`), and
   `tf/variables.tf` `instance_name`. Tests that assert the old fallback move with it.
2. **The product site.** `site/index.html` title, eyebrow, OG/Twitter titles, descriptions and
   image alt, the web manifest, the footer, the install line; `site/og.png` regenerated from
   `scripts/og-cards/site-card.html`. The definition line ("Community drafting and signing of
   collective statements") is the *tagline* and stays — it is what the product does, not what it
   is called. The favicon set carries no wordmark and is untouched. No tenant is named.
3. **The admin CLI and its skill.** `drafter-axi` → `signatories-axi`; `skills/drafter-axi/` →
   `skills/signatories-axi/` (SKILL.md, the bash shim, the committed bundle, the generated command
   reference, the SessionStart hook hints); `packages/cli` build paths and `reference.ts`; every
   `drafter-axi …` hint emitted by the CLI, printed in `apps/web` admin copy, or shown on the site.
   The config directory moves `~/.config/drafter/` → `~/.config/signatories/` and the environment
   variables `DRAFTER_PROFILE` / `DRAFTER_URL` / `DRAFTER_TOKEN` become `SIGNATORIES_*`, **with
   backward compatibility**: an existing profile in the old directory is still read when the new
   directory has none (announced once on stderr), and the old variable names are still honoured as
   fallbacks. New writes always go to the new directory.
4. **Workspace package names.** `@community-drafter/*` → `@signatories/*`, with every import and
   `workspace:*` reference updated, if and only if it stays mechanical.
5. **Specs and docs.** `specs/README.md`, `specs/architecture.md`, `specs/api/admin-cli.md`,
   `specs/api/auth.md`, `specs/behaviors/operators.md`, `specs/behaviors/sites.md`,
   `specs/screens/marketing-site.md`, `docs/operations.md`, `README.md`, `CLAUDE.md`. The pilot
   stays unnamed in specs. "Community Drafter" survives in exactly one place, as a "formerly" line
   in `README.md`, so someone arriving from an old link knows they are in the right repository.
6. **Verification.** Gates in every package, the CLI bundle drift gate, and a browser check of the
   renamed hero at 1280 and 390.

**Out:**

- **The GitHub repository rename** and the Workload Identity binding that follows it. The
  coordinator does both after this merges; `JarvusInnovations/community-drafter` therefore stays
  correct in the install line and the repo links until then, and GitHub's redirect covers the gap.
- **The GCP project, Cloud Run service, Artifact Registry image path, and every `tf/` resource
  name** — all `community-drafter`. Renaming an identifier a deployed resource is keyed on is a
  migration, not a rename, and nobody reads them.
- **`tf/terraform.tfvars`.** The coordinator pins `instance_name` there; this plan only moves the
  variable's default.
- The data repo, the `.gitsheets/` sheet names, git history, and the `Claude-Session` trailers.
- Migrating any human's `~/.config/drafter/*.toml`. The compatibility read is what makes that
  unnecessary, and nothing in this repo touches a real config directory.

## Implements

- `specs/README.md` and `specs/architecture.md`: the system's name, and the skill directory the
  bundle ships from.
- `specs/api/admin-cli.md` § Configuration and § Commands: the tool's name, the profile path, the
  environment variables, and the one-invocation-form-per-surface rule (which now reads
  `signatories-axi …` on the CLI's own surfaces and `scripts/signatories-axi` in SKILL.md).
- `specs/api/auth.md` § Session and `specs/behaviors/sites.md` § The default site: the
  `INSTANCE_NAME` fallback.
- `specs/behaviors/operators.md`: the CLI token's storage path and the `login`/`logout`/`whoami`
  command names.
- `specs/screens/marketing-site.md`: the name in the hero, the share preview, and the install line.

## Approach

1. This plan, committed first.
2. Specs, in one `docs(specs)` commit — the name, the CLI name, the config path and variables, and
   the backward-compatibility rule, which is behavior and therefore has to be specified before it
   is written.
3. Package names (`@signatories/*`) plus their imports, then `bun install` and `bun.lock` in its
   own commit if the lock moves.
4. The API and the web app: fallbacks, titles, copy, the instance OG card.
5. The CLI: rename the source's identity and config layer, `git mv skills/drafter-axi
   skills/signatories-axi`, rebuild with `cd packages/cli && bun run build`, and let the drift gate
   prove the bundle and the generated SKILL.md region match the source.
6. The site, and `site/og.png` regenerated from its source card with `chrome-devtools-axi`.
7. `docs/operations.md`, `README.md`, `CLAUDE.md`, and the `tf/variables.tf` default.
8. Verification: the gate set in every package, the drift gate, the grep sweep, and the two hero
   screenshots.

The backward-compatible config read is the one piece with real behavior in it. Shape: resolve the
new directory first; if it holds no profile for the selected name and the old one does, read the
old file and print a single line on stderr saying where it came from and that a fresh `login`
writes to the new place. Environment lookup is new name first, old name second, and the old name
never appears in output.

## Validation

- [x] `bun run lint`, `bun run format:check`, `bun run typecheck` and `bun test` pass at the root
      (every workspace package), and `apps/web` additionally passes `bun run build` and
      `bun run check:bundle-size`. 421 tests pass, 0 fail (api 232, web 103, shared 35, cli 51);
      the web bundle is 106.63 KB gzip against a 120 KB budget. Lint reports only the warnings that
      were already there. Re-run after the rebase onto `4d40e06`.
- [x] `cd packages/cli && bun run build` is a no-op against the committed bundle and SKILL.md —
      the drift gate (`bun test` in `packages/cli`) passes with the renamed paths.
      `build-cli.ts --check` and `build-skill.ts --check` both report "up to date".
- [x] A profile written to `~/.config/signatories/` is read back; a profile present only in
      `~/.config/drafter/` is still read, with one line on stderr saying so; `DRAFTER_URL` and
      `DRAFTER_TOKEN` still resolve when `SIGNATORIES_*` are unset. Covered by tests that sandbox
      `$HOME`, never a real config directory (`packages/cli/src/cli/config.test.ts`, six cases).
      Also proved against the built bundle under a temporary `$HOME`: the note names the old file
      and the new directory, and the command then proceeds normally.
- [x] The grep sweep for `drafter-axi`, `Community Drafter` and `DRAFTER_` over tracked source,
      markdown, HTML, TOML and JSON returns only deliberate leftovers: the compatibility paths, the
      `README.md` "formerly" line, the out-of-scope infrastructure identifiers, and closed plan
      files that are historical record. The full list is in PR #104.
- [x] The site's hero reads "Signatories" at 1280 and at 390 with no horizontal scroll, and
      `site/og.png` shows the new name. `document.scrollWidth` equals `clientWidth` at both widths;
      screenshots are in PR #104 and the `.verification/` directory is removed by this commit.
- [x] Nothing in `tf/` changes except the `instance_name` default; `tf/terraform.tfvars` is
      untouched.

## Risks / unknowns

- **The bundle is 130 KB of generated JavaScript that moves directory.** A `git mv` plus a rebuild
  is the only safe order; rebuilding into the new path without moving leaves a stale copy at the
  old one. `.gitattributes` has to follow the file or the diff swamps the PR.
- **Renaming the environment variables is the only user-visible break.** Anyone with
  `DRAFTER_URL`/`DRAFTER_TOKEN` exported in CI keeps working because of the fallback, but the
  fallback is the compatibility surface and needs a test, not a comment.
- **The skill directory name is what `npx skills add --skill` selects.** An adopting repo that
  already installed `drafter-axi` does not get a rename; it gets a second skill. That is a
  follow-up for whoever has installed it, and there is exactly one such repo today.
- **Workspace package renames can cascade** into tsconfig references, test mocks and Vite aliases.
  If it stops being mechanical, the package names stay and the PR says so.
- **The repo rename lands after this.** Every `JarvusInnovations/community-drafter` link here is
  correct until it does and redirected after, so nothing needs a second pass — but a future reader
  seeing the old owner/repo in the install line should know it is deliberate.

## Notes

**The workspace package rename stayed mechanical**, so scope item 4 went ahead: four `name`
fields, two `workspace:*` references, every import, and the package matrices in `lint.yml` and
`test.yml`. Nothing in the tsconfig project references or the Vite config named a package, which
is what would have made it a rabbit hole. The shorter name changes where a few import lines wrap,
so `oxfmt` reflowed two files; that is in its own `style(web)` commit.

**Two identifiers were found mid-rename and deliberately left alone**: the public embed attribute
`data-drafter-doc` (`specs/screens/public-and-embed.md`) and the CSRF header value
`X-Requested-With: drafter` (`specs/api/admin.md`). Both are wire identifiers that a deployed
embed or a signed-in browser depends on, and neither is a name a person reads. Renaming them is a
breaking change that would have to be staged, not folded into a rename pass.

**The data repo's own git identities moved** (`bootstrap@`, `participant@`, `system@` are now
`…@signatories.local`). Nothing keys on them — they are commit author fields — so a data repo will
simply carry both spellings across the boundary, which is exactly what its history should show.

**`hook install` had to learn to replace, not add.** The SDK's `computeSessionStartHookUpdate`
matches on a marker, so installing under the new name beside an existing `drafter-axi` hook would
have left two SessionStart entries, one of them pointing at a skill directory that no longer
exists. Install now strips the legacy marker first and reports `replaced`; uninstall removes
either. Stripping only the *legacy* marker matters: stripping both would break the idempotent
"already up to date" answer.

**The branch was rebased onto `origin/develop` at `4d40e06`** partway through, picking up nine
commits (PR #103 and the deploy that followed). No conflicts, and every gate was re-run after.

## Follow-ups

- **Rename the GitHub repository and update the Workload Identity binding** (`var.github_repo` and
  the `principalSet` condition in `tf/iam.tf`). The coordinator's, deliberately out of this plan's
  scope. Until it happens `JarvusInnovations/community-drafter` is correct in the install line, the
  site's repo links and `specs/screens/marketing-site.md`; after it, GitHub redirects.
- **Pin `instance_name = "Signatories"` in `tf/terraform.tfvars` and apply.** This plan moved only
  the variable's default, and the tfvars pin wins. Until the apply, the deployed instance still
  serves the old name.
- **Nothing is required of anyone with `~/.config/drafter/`.** The next `login` moves the profile.
  Someone who wants it moved now can `mv ~/.config/drafter ~/.config/signatories`.
- **The one adopting repo that installed `drafter-axi`** gets a second skill, not a rename, on its
  next `npx skills add`. Remove the old directory there, then run `signatories-axi hook install`,
  which clears the stale hook as part of installing.
- **A per-instance share card** stays unfiled, as `share-previews` left it: the generic card now
  says "Signatories" instead of "Community Drafter", and an instance wanting its own wording still
  needs a rendered card or a configurable image path. Nobody has asked.
- No downstream plan absorbs anything from this one.
