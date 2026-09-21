---
status: done
depends: []
issues: [56, 60]
pr: 97
specs:
  - specs/screens/admin-dashboard.md
  - specs/api/conventions.md
  - specs/behaviors/review-and-judgement.md
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

- [x] At 390 px, `document.scrollingElement.scrollWidth` equals the viewport width on `/admin`, `/admin/operators`, `/admin/d/<slug>`, `/admin/d/<slug>/people`, `/admin/d/<slug>/submissions`, `/admin/d/<slug>/versions`, and on a participant document containing a five-column Markdown table. Measured before (445 / 445 / 795) and after (390 everywhere); the participant document measured 390 before the branch too.
- [x] Each table wider than its card scrolls inside the card and carries a visible hint; the add-operator select fits its column with every operator name in it.
- [x] `/login` returns the SPA shell and renders the "not available" page, not a JSON 403; a client asking for JSON, and any non-`GET`, still gets the JSON 404. Covered by `apps/api/src/routes/static.test.ts`.
- [x] No admin surface prints a raw locale timestamp; `grep -rn "toLocaleString" apps/web/src` returns nothing outside tests.
- [x] The submissions filters are each labeled; the funnel draws nothing for a zero count; revoked signatures and revoked links read as two different numbers; "Extend deadline…" is not offered on a draft with no deadlines, and the API's refusal names the deadline in words (`no_deadline_set`, covered by `documents.test.ts`).
- [x] `versions publish` prints no `signing_closes_at` line when the publish did not move it; `people links --out` writes `0600` (covered by `e2e.test.ts`, including over an existing 664 file); an empty feedback export does not end on a bare heading.
- [x] `bun run lint`, `format:check`, `typecheck`, `test` and `build` pass across the workspace (379 tests, 0 failures); `check:bundle-size` reports 106.49 KB gzip against the 120 KB budget.

## Risks / unknowns

- **Several bullets may already be fixed.** `participant-fixes-2`, `redline-quality` and the a11y pass landed hours before the issues were filed; the `fourfive` guard, the view-as second `h1` and the capacity radios' `name` all read as already done. Verify each against the running app before writing a fix, and say so rather than claiming a change that was not made.
- **Splitting the revoked tile changes a number the team reads.** Counting revoked signatures and revoked links separately makes both smaller than the single figure shown before; the spec change has to land first so the new numbers are the specified ones.
- **The bundle budget.** #60 adds copy and a little markup to the participant entry; the 120 KB gzip budget is checked in the gates.

## Notes

- **Three of #60's bullets were already fixed** by plans that landed between the run and the issue being filed, and are recorded here so nobody re-opens them: the compare view's "fourfive" run-together (the `wouldRunTogether` guard in `packages/shared/src/diff/index.ts`, from the redline work), the second `h1` on view-as (`DocumentHeader` demotes its title under `readOnly`), and the capacity radios' missing `name` (both `SignForm` and `ReviewTray` carry `${formId}-capacity`). Verified in the code; no change made.
- **Most of #56 was already fixed too, and the issue's diagnosis was wrong about which part.** The four wide tables *were* clipped by their `overflow-x-auto` cards, and the participant document's Markdown table *was* scrolling inside its column (`.doc-body table` is `display: block`). What actually pushed the page sideways was the top bar (445 px) and the add-operator `<select>` (795 px). Measuring first, before writing any fix, is what kept this branch from "fixing" three things that were not broken — and it surfaced the real remaining defect in the tables, which is that a clipped table with no hint looks like a table missing its last four columns.
- **The gateway change is one line and worth understanding.** Its `preHandler` denies any matched route that declares no capability; Fastify runs that hook for the not-found route too, whose `routeOptions.config` is empty, so every unrouted address came back 403. `routeOptions.url === undefined` is the signal that nothing matched, and it is the only case where letting the request past is not a hole: there is no handler behind it but the 404.
- **`setNotFoundHandler` takes no route config.** The first attempt passed `{ config: PUBLIC_ROUTE }`, which runs fine and does nothing — it only failed at `tsc`. The gateway change is what makes the handler reachable.
- **The revoked split changes a number the team has been reading.** What was one "REVOKED" tile is now two smaller ones. That is the point (a revoked link is not a withdrawn signature), but a team comparing against last week's screenshot will see the figure drop.
- **Local visual checks need a 390 px viewport, which headed Chrome on this machine will not give.** `chrome-devtools-axi resize` reports success and does not take effect, and Chrome refuses a window narrower than 500 px. The way through was a same-origin `/__frame?w=390&p=<path>` harness on the throwaway server, rendering the target path in a 390 px iframe — which needs the SPA shell's `X-Frame-Options: DENY` stripped, so that lived in the throwaway script and never in the app.

## Follow-ups

- **Issue to file — Open Graph tags on the public read page.** The `<title>` half of #60's bullet shipped; `og:title`/`og:description`/`og:image` need the API to template the SPA shell per document, which means deciding what a document with `public_access = none` exposes to a scraper. A product decision, not a wording fix.
- **Issue to file — a compare affordance in the admin version history.** `specs/screens/admin-dashboard.md` § Versions says the page is "as the participant history", and the participant history has compare; the admin has no compare screen at all. This is a feature with its own plan, not a link.
- **Issue to file — "This link isn't available" names no team or address.** The page renders identically for unknown, revoked and expired tokens by design (`behaviors/access-and-identity.md`: existence is never disclosed), so it has no document and no team to name. Naming an instance-wide fallback address is a product decision about what the instance admits to anyone holding a dead link.
- **Issue to file — reproduce the ~14-minute operator session.** Not reproducible from the code: `SESSION_TTL_SECONDS` is 24 h, the cookie's `Max-Age` is the same value, and `AUTH_SECRET` is required in production so a restart does not invalidate a session. Needs a repro against the deployed instance before anything is changed.
- **Issue to file — an unknown path under an API prefix returns the SPA shell with a 200.** `/admin/api/nope` matches the `/admin/*` shell wildcard, so a JSON client asking for a mistyped endpoint gets HTML and a success code. Pre-existing and out of #60's scope, but adjacent to the unrouted-path fix: the three API prefixes should answer their own 404s.
