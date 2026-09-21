---
status: in-progress
depends: []
issues: [56, 60]
specs:
  - specs/screens/admin-dashboard.md
  - specs/screens/document.md
  - specs/screens/public-and-embed.md
  - specs/screens/version-history.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
---

# Plan: admin-phone-and-copy

## Scope

The two web-polish issues left by the 2026-09-20 simulated campaign run, taken together because both are read-and-fix passes over the same admin screens:

- **#56** — nothing on an admin page may push the page sideways at 390 px. The add-operator `<select>`, the four `min-w-[…]` tables, the top bar's wordmark/email, and a wide Markdown table inside a participant document.
- **#60** — the copy-and-polish batch. Every bullet that is a clear defect or a wording fix.

Out, and listed in Follow-ups instead: Open Graph tags on the public read page (needs the API to template the SPA shell per document — a design decision, not a wording fix); an admin compare view (a screen that does not exist yet); naming a team or address on the "This link isn't available" page (a disclosure decision — the page renders for unknown, revoked *and* expired tokens and deliberately cannot say which); and the fourteen-minute session observation, which the code contradicts (see Notes).

## Implements

- `specs/screens/admin-dashboard.md` § Design — a new **phone width** rule: no admin page scrolls the page sideways at 390 px; a table wider than its card scrolls inside the card and says so; a filter or picker whose options are long shrinks to its column rather than setting it.
- `specs/screens/admin-dashboard.md` § Dashboard — the funnel bar draws no segment for a zero count; revoked signatures and revoked links are counted as two separate tiles (the run read one "REVOKED 1" tile as a revoked signature when a link had been revoked); "Extend deadline…" is offered only when there is a deadline to extend; the notification panel shows the dispatcher's failures, not only their count.
- `specs/screens/admin-dashboard.md` § Design — admin surfaces use the same absolute date form as the participant screens (`screens/document.md` § Design "Dates"), never a raw locale timestamp.
- `specs/screens/admin-dashboard.md` § Versions — the current version is marked, and a version's text is readable in the console rather than only downloadable.
- `specs/screens/document.md` § Display Rules — the "Not you?" explanation names the sender the document is sent under.
- `specs/screens/public-and-embed.md` — the browser tab names the document; the standalone signatories page uses the same card and type as the rest of the public family.
- `specs/api/admin.md` — extending a deadline a document does not have is `no_deadline_set`, whose message names the deadline in words and points at `docs open`, not `comments_close_at must move later`.
- `specs/api/admin-cli.md` — `versions publish` omits `signing_closes_at` when the publish did not move it; `people links --out` writes its credential file `0600`.

## Approach

1. Specs first, in one `docs(specs)` commit: the phone rule, the funnel/tiles/extend/notifications/versions rules, the date rule, the participant sentence, the public-page rules, and the two API/CLI lines.
2. **#56** (`apps/web/src/admin/`, `apps/web/src/index.css`): measure `scrollWidth` at 390 px against a seeded throwaway instance first — several of the listed cases already carry an `overflow-x-auto` card or a `display:block` table from earlier plans — then fix only what still overflows. Expected shape: `min-w-0` on the flex chains that feed a select or a table, a `max-w-full` select, a scroll hint above a table that is wider than its card, and a top bar whose right-hand group wraps with the email truncating.
3. **#60**, in one commit per group so a reviewer can read them apart:
   - **Routing**: a catch-all route in `App.tsx` rendering the participant `NotFoundScreen`, and a Fastify not-found handler that serves the SPA shell for an HTML `GET` (JSON elsewhere), so `/login` stops returning the gateway's raw 403.
   - **Admin dates**: every `toLocaleString()` on an admin surface becomes `formatAbsolute` from `participant/format.ts`.
   - **Admin screens**: labeled submission filters (version and judgement become selects over the document's own values; person a labeled search box); funnel segments sized by count; revoked split in two; "Extend deadline…" gated on a deadline existing; notification failures listed; the versions list marks the current version and shows a version's text.
   - **Participant/public copy**: "Not you?" names the sender; the tab title names the document; the signatories page gets the public family's card.
   - **Form fields**: `id`/`name` on the comment-mode and sign-card inputs that had neither.
   - **API/CLI**: `no_deadline_set`; the empty feedback export's "None yet" line; `versions publish` omitting a null deadline; `people links --out` at `0600`.
4. Rebuild the `drafter-axi` skill bundle if the CLI changes, in its own commit.
5. Browser check at 390 and 1280 on every #56 page, against a throwaway data repo seeded with several versions and operators; screenshots committed under `.verification/` and deleted at closeout.

## Validation

- [ ] At 390 px, `document.scrollingElement.scrollWidth` equals the viewport width on `/admin`, `/admin/operators`, `/admin/d/<slug>`, `/admin/d/<slug>/people`, `/admin/d/<slug>/submissions`, `/admin/d/<slug>/versions`, and on a participant document containing a five-column Markdown table.
- [ ] Each table wider than its card scrolls inside the card and carries a visible hint; the add-operator select fits its column with every operator name in it.
- [ ] `/login` returns the SPA shell and renders the "not available" page, not a JSON 403.
- [ ] No admin surface prints a raw locale timestamp; `grep -rn "toLocaleString" apps/web/src` returns nothing outside tests.
- [ ] The submissions filters are each labeled; the funnel draws nothing for a zero count; revoked signatures and revoked links read as two different numbers; "Extend deadline…" is not offered on a draft with no deadlines, and the API's refusal names the deadline in words.
- [ ] `versions publish` prints no `signing_closes_at` line when the publish did not move it; `people links --out` writes `0600`; an empty feedback export does not end on a bare heading.
- [ ] `bun run lint`, `format:check`, `typecheck`, `test`, `build` and `check:bundle-size` all pass in `apps/web`; the API and CLI suites pass.

## Risks / unknowns

- **Several bullets may already be fixed.** `participant-fixes-2`, `redline-quality` and the a11y pass landed hours before the issues were filed; the `fourfive` guard, the view-as second `h1` and the capacity radios' `name` all read as already done. Verify each against the running app before writing a fix, and say so rather than claiming a change that was not made.
- **Splitting the revoked tile changes a number the team reads.** Counting revoked signatures and revoked links separately makes both smaller than the single figure shown before; the spec change has to land first so the new numbers are the specified ones.
- **The bundle budget.** #60 adds copy and a little markup to the participant entry; the 120 KB gzip budget is checked in the gates.

## Notes

(closeout)

## Follow-ups

(closeout)
