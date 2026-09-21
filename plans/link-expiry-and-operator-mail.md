---
status: in-progress
depends: []
issues: [13, 11, 77]
specs:
  - specs/api/admin-cli.md
  - specs/data-model.md
  - specs/behaviors/notifications.md
---

# Plan: link-expiry-and-operator-mail

## Scope

Three small, independent housekeeping items that all turn on the same theme — a capability
exists in the record or the API but nothing tells the operator (or the new operator) about it.

1. **#13** — `POST /documents/:slug/invitations/:person/expire` has no CLI command. Add
   `people expire <slug> <person> --expires-at <when>` to `specs/api/admin-cli.md` and wire it
   into `packages/cli/src/cli/commands/people.ts` next to `revoke-link`/`reissue-link`.
2. **#11** — `specs/data-model.md`'s `Action` trailer row is the canonical list and must match
   `packages/shared/src/records/trailers.ts` exactly. (It already lists every current value;
   this plan verifies the match and removes the "fold these in later" apology comment the
   `api-core` plan left in `trailers.ts`.)
3. **#77** — a person made an operator, or added to a document, is never told. Add two
   operator-facing messages — `operator-added` and `operator-added-to-document` — to
   `specs/behaviors/notifications.md`'s catalogue and send them from `POST /operators` and
   `POST /documents/:slug/operators`.

Out of scope: any change to the `expire` endpoint itself (it exists and is correct); a CLI or
dashboard surface for operator mail; a message on `operator-remove` / `doc-operator-remove`
(losing access is not a thing this plan promises to announce); SMS.

## Implements

- **`specs/api/admin-cli.md`** § Commands — `people expire <slug> <person> --expires-at <when>`
  joins the `revoke-link | reissue-link` row's neighbourhood as its own row, taking the same
  `<when>` grammar as `docs open` (ISO 8601 with a zone, or a zone-less local time the CLI
  echoes as it resolved it) so an operator never has to hand-write a UTC timestamp.
- **`specs/data-model.md`** § Commits are the events — the `Action` row lists exactly the values
  in `packages/shared/src/records/trailers.ts`: `link-export`, `link-expire`, `uninvite`,
  `operator-add`, `operator-update`, `operator-remove`, `doc-operator-add`,
  `doc-operator-remove` alongside the original set.
- **`specs/behaviors/notifications.md`** § Messages — two rows:
  - `operator-added` — an operator record is created → that operator. Names the instance, says
    who created the account, gives `<instance>/admin` and the fact that sign-in is an emailed
    link, not a password.
  - `operator-added-to-document` — an operator is added to a document → that operator. Names
    the document and who added them, and links `<instance>/admin/d/<slug>`.
  Both carry the same "not a participation message" caveat `operator-magic-link` does, and
  § Sending gains one rule covering how *all* operator-facing mail is recorded.

## Approach

1. **Plan first**, then specs in one `docs(specs)` commit, then code per issue.
2. **#13 (CLI).** `PEOPLE_FLAGS.expire = { positionals: 2, value: ["--expires-at"] }`; a new
   `case "expire"` posting `{ expires_at }` to the endpoint; `ExpireLinkResult` in
   `types.ts`; a `people expire` entry in `PEOPLE_HELP` and in `reference.ts`'s `COMMAND_GROUPS`
   (which is what regenerates `SKILL.md`). `--expires-at` is resolved through the existing
   `deadline.ts` helper that `docs open`/`docs extend` use, so the grammar and the echo are the
   same. Rebuild the bundle (`cd packages/cli && bun run build`) and commit `skills/drafter-axi/`.
   An e2e case in `packages/cli/src/e2e.test.ts` drives it against the real API.
3. **#11 (docs).** Reconcile the table against `ACTIONS` and drop the stale follow-up comment.
4. **#77 (mail).** A new `apps/api/src/notifications/operator-mail.ts` exporting
   `sendOperatorAdded` and `sendOperatorAddedToDocument`, rendered through
   `lib/mailer/shell.ts`'s `renderEmail` + `firstName` and sent through `fastify.mailer`
   directly — the same path `auth/routes.ts` uses for `operator-magic-link`, because the
   dispatcher is participation-shaped (it resolves a `RecipientContext` from a participation
   record) and an operator has none. Called from `routes/admin/operators.ts` *after* the commit
   lands, awaited but never allowed to fail the request: the membership is the fact, the email
   is the courtesy. Skipped when the recipient is the actor.

## Validation

- [ ] `drafter-axi people expire <slug> <person> --expires-at <iso>` sets `expires_at` on the
      participation and prints what it resolved to; a zone-less time is read in the machine's
      local zone and echoed; a missing `--expires-at` is a usage error naming the flag.
- [ ] `specs/data-model.md`'s `Action` row and `ACTIONS` in
      `packages/shared/src/records/trailers.ts` are the same list, in the same order, with no
      "fold this in later" comment left behind.
- [ ] `POST /operators` emails the new operator once: the instance name, who created the
      account, `<instance>/admin`, and the "sign-in is a link, not a password" line. No token,
      no participant data, no `notified` write.
- [ ] `POST /documents/:slug/operators` emails the added operator once, naming the document,
      who added them, and `<instance>/admin/d/<slug>`.
- [ ] Neither message is sent when the operator being added is the operator doing the adding.
- [ ] `skills/drafter-axi/` is rebuilt and the bundle drift gate passes.
- [ ] Gates green in every touched package: `lint`, `format:check`, `typecheck`, `test`.

## Risks / unknowns

- **Where operator mail failures show.** `notifications list <slug>` and the dashboard's
  failure list are the *dispatcher's* in-memory buckets, keyed by document and re-sent by
  re-rendering a participation context. An operator message has no participation, so putting
  one in that bucket would make it permanently unretryable (a retry resolves no participation,
  counts the target as skipped, and never clears the entry). Recording is therefore a log line,
  as with `operator-magic-link`, and the spec is amended to say so rather than left silent.
- **A failing mailer must not fail the write.** The commit is already in the repo by the time
  the send runs; an exception escaping the handler would report failure for an action that
  succeeded. Every send is wrapped.

## Notes

## Follow-ups
