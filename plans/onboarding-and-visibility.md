---
status: done
depends: []
issues: [55, 54, 66, 37]
pr: 76
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

- [x] A new operator following only the website reaches `/admin/login` and the CLI install without guessing (walk it once in a fresh browser session; screenshots).
- [x] `people import --help` and `versions publish --help` show fields and outcomes; `docs show` prints the public URL for a `read` document.
- [x] View-as shows the attestation text for an official-capacity invitee, disabled.
- [x] A superadmin action on a document they are not on shows the label in the activity feed.
- [ ] #55 #54 #66 #37 closed by the PR. — #54 and #37 close; #55 and #66 stay open, see Notes.

## Risks / unknowns

- The site's screenshots may need one re-capture if the "Getting in" section references the sign-in page; capture from the live instance.

## Notes

- **Two issues stay open on purpose.** #54 and #37 are closed by PR #76. #55 keeps one
  unshipped item — new operators get no email when they are created or added to a
  document — which is a notifications change with its own message template, not
  onboarding copy. #66 gets its "I cannot tell whether this was a colleague with
  standing or a compromise" half: the activity feed now labels a superadmin actor who
  is not on the document. The access-boundary half it also raises (a non-operator being
  able to write at all; the instance-wide operator directory being enumerable and
  editable by every operator) is operator scoping, #50, which this plan's Scope puts
  out of bounds.
- **One invocation form, but per surface.** The plan said "unify hints on `drafter-axi …`
  and note the scripts path once in the home view". Applied literally to `SKILL.md` too,
  that would have broken copy-paste for an agent reading the skill, where
  `scripts/drafter-axi` is the runnable form. The spec now says one form *per surface*:
  the CLI's own output is uniformly `drafter-axi …` with the resolved shim path printed
  once as the home view's `invoke_as`; `SKILL.md` stays on `scripts/drafter-axi`,
  declared at its top. Within either surface the form never varies, which is what the
  personas actually complained about.
- **The instance root was already fixed.** Every persona hit "Workspace bootstrap
  placeholder — see specs/README.md" at `/`; that deployment predated the current
  `HomePage`, which already renders the card and Sign in button
  `admin-dashboard.md` § Navigation calls for. Nothing to do here beyond telling people
  on the website that the address exists.
- **View-as disables links by turning them into buttons.** A disabled `<a>` is not a
  thing; an `aria-disabled` link still navigates on Enter. `InertLink` renders a real
  `<button disabled>` under `readOnly`, so "every action control is disabled" holds for
  the keyboard and assistive technology, not just visually. The footer's `mailto:`
  "Questions?" link is left alone — it acts on nothing and is part of the page the
  operator is checking.
- **`people import` already documented its fields**; `staged-invitations` (PR #75) added
  that. What was missing was required-vs-optional and the fact that unknown keys are
  dropped silently — which is what actually cost the personas their time, since they
  guessed `organization` and `title` rather than `org` and `role`.
- **Gotcha found while seeding the verification instance**: a `DELETE` with
  `content-type: application/json` and no body returns Fastify's
  `FST_ERR_CTP_EMPTY_JSON_BODY` (a 400) rendered through the error handler as
  `internal_error`. Unrelated to this plan; see Follow-ups.

## Follow-ups

- Issue [#77](https://github.com/JarvusInnovations/community-drafter/issues/77) — tell a
  new operator they exist: an email when an operator record is created, and when one is
  added to a document (#55, item 8).
- Issue [#78](https://github.com/JarvusInnovations/community-drafter/issues/78) — a
  request whose body fails Fastify's content-type parsing (e.g. `DELETE` with
  `content-type: application/json` and no body) surfaces as `internal_error` instead of
  a 400 `invalid_request`.
- Tracked as: #50 (operator scoping) owns the rest of #66 — whether an account outside
  `docs operators` may write at all, and whether every operator should be able to
  enumerate and edit the whole instance directory.
