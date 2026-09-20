---
status: planned
depends: []
specs:
  - specs/screens/marketing-site.md
  - specs/api/admin-cli.md
  - specs/screens/admin-dashboard.md
  - specs/behaviors/operators.md
  - specs/api/auth.md
---

# Plan: onboarding-and-visibility

## Scope

What every operator persona hit in their first fifteen minutes (#55), plus three visibility gaps (#54 view-as hides the sign card, #66 superadmin actions unlabeled in a document's activity, #37 instance name in the admin bar). Out: operator scoping (#50), web authoring (#53).

## Implements

- `specs/screens/marketing-site.md` — a "Getting in" section: where operators sign in, that a web console exists at `/admin`, how to get an instance or ask for one, and what the CLI is for; the "Running one" section names the console next to the CLI.
- `specs/api/admin-cli.md` — `people import` documents its row fields; `versions publish` documents the disposition outcomes (`accepted`, `partial`, `declined`, `noted`) in `--help`; `docs create/show/open` print the public URL when `public_access` is not `none`; help hints use one invocation form.
- `specs/screens/admin-dashboard.md` — view-as renders the full sign card with every control disabled (not a summary sentence); the activity feed labels a superadmin actor; the top bar shows the configured instance name.
- `specs/behaviors/operators.md` § Superadmins — activity entries by a superadmin who is not on the document are labeled.
- `specs/api/auth.md` — `GET /auth/session` also returns `instance_name`.

## Approach

1. Website: a short "Getting in" section between "What it is" and "How it works"; the skill's `SKILL.md` gains a human-readable quickstart at the top (sign in, create, publish, open, invite, revise) before the agent-facing reference; fix the site's "partly" to match the API's "partial" or vice versa (pick "partly addressed" as the label, `partial` as the value).
2. CLI: `people import --help` lists fields and points at `--dry-run`; `versions publish --help` lists outcomes with one line each; `docs create/show/open` print `public_url`; unify hints on `drafter-axi …` and note the scripts path once in the home view.
3. View-as: render `SignForm`/`StatusCard` in a disabled state instead of `ReadOnlyStatusCard`'s sentence (a `readOnly` prop that disables inputs and buttons and drops the network calls).
4. Activity feed: actor rendered as "<chris@jarv.us> (superadmin)" when the actor is not in the document's operators and is a superadmin; the read model knows both.
5. `GET /auth/session` returns `instance_name`; the admin bar uses it (closes #37).

## Validation

- [ ] A new operator following only the website reaches `/admin/login` and the CLI install without guessing (walk it once in a fresh browser session; screenshots).
- [ ] `people import --help` and `versions publish --help` show fields and outcomes; `docs show` prints the public URL for a `read` document.
- [ ] View-as shows the attestation text for an official-capacity invitee, disabled.
- [ ] A superadmin action on a document they are not on shows the label in the activity feed.
- [ ] #55 #54 #66 #37 closed by the PR.

## Risks / unknowns

- The site's screenshots may need one re-capture if the "Getting in" section references the sign-in page; capture from the live instance.

## Notes

(closeout)

## Follow-ups

(closeout)
