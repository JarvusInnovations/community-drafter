---
status: done
depends: [participant-sign-flow, comment-mode]
specs:
  - specs/screens/admin-dashboard.md
  - specs/behaviors/access-and-identity.md
pr: 20
---

# Plan: admin-dashboard

## Scope

Google OAuth for admin humans (allowlist, HMAC cookie session, CSRF header), the `/admin` route family (document list, dashboard, people, submissions, versions, view-as) as read-mostly views with the few conveniences the spec allows (extend deadline, copy/export links, revoke/reissue link, revoke signature, export feedback). Out: creating documents, publishing, importing and sending from the web (CLI-only in phase 1).

## Implements

- `specs/screens/admin-dashboard.md` — all.
- `specs/behaviors/access-and-identity.md` — *Admin access* (dashboard side).

## Approach

1. OAuth per the proposal-renderer `auth.ts` behavior and the `jarvus-fastify` authentication reference: `/auth/login`, `/auth/callback`, `/auth/session`, `/auth/logout`; in-memory session store; CSRF header required on cookie-authenticated writes. The gateway's admin-transport hook point already exists: `api-core`'s `apps/api/src/gateway/gateway.ts` `resolveAdmin` resolves bearer only and throws `unauthenticated` when `Authorization` is absent — add the cookie-session branch there (checked only when the header is absent, per "a present `Authorization` header is decisive," never as a fallback from a failed bearer check), producing an `AdminPrincipal` with `{ kind: "admin"; email }` (the `capability.ts` `AdminPrincipal` type already accommodates an email-based actor, distinct from the bearer path's `{ kind: "cli"; label }`).
2. Pages over the admin API: funnel from participation statuses; versions table; recent activity from `activity`; notification health; people table with URL-state filters; submissions page grouped whole with the secondary by-passage view; view-as rendering the participant document screen read-only with a banner.
3. Every admin action dialog requires a reason where the spec says so and shows the resulting commit subject on success.

## Validation

- [x] An email outside the allowlist is refused at `/auth/callback`; an allowed one lands on `/admin` with a session that expires in 24 h. (`apps/api/src/auth/auth.test.ts`; also exercised live via the dev bypass in the browser walkthrough.)
- [x] A cookie-authenticated request and a bearer-authenticated request are never accepted together, and a request presenting both an `Authorization` header and a session cookie resolves via bearer only (deferred from `api-core`, PR #10 — the gateway's transport-resolution order). (`auth.test.ts` "a request presenting both a session cookie and a bearer header resolves via bearer only".)
- [x] A cookie-authenticated POST without the CSRF header is rejected; with it, succeeds. (`auth.test.ts`; also exercised live in the browser walkthrough via a hand-issued `fetch` from the signed-in tab.)
- [x] People table filters are in the URL and survive reload; no token appears in any rendered page except after the explicit copy/export action, which appears in activity. (`PeopleScreen.test.tsx`; also exercised live: `?status=drafting` survived a full page reload, and the token only appeared in the DOM after "Copy personal link", recorded as a `link-export` activity entry attributed to the admin.)
- [x] Submissions page shows a draft only under the "Unsubmitted" group and never renders a comment detached from its submission (component test). (`SubmissionsScreen.test.tsx`.)
- [x] View-as renders the participant page with every control disabled and the banner present. (`ViewAsScreen.test.tsx`, zero enabled buttons/inputs/selects; also exercised live. Deviation: the participant `Signatories`/`SubmissionsSection` components' own non-mutating disclosure toggles — "show all", the drafts `<details>` — weren't threaded with `readOnly`, since they're not entries in the Actions table; see Notes.)
- [ ] Extend deadline with an earlier time shows the `deadline_not_later` message; a later time appears in activity with old and new times. First half verified (`ExtendDeadlineDialog.test.tsx`; also live in the browser walkthrough — submitting unchanged times surfaced the exact server message). Second half only partially true: the extension is genuinely recorded and reflected in the dashboard and in `GET .../activity` (as `extend: <slug> comments_close_at, signing_closes_at`, attributed to the admin), and the dialog's own success banner shows old→new times client-side — but the activity *commit subject itself* (inherited from already-merged `api-core`) doesn't carry the literal timestamp values. Left unchecked; tracked as [issue #21](https://github.com/JarvusInnovations/community-drafter/issues/21).

## Risks / unknowns

- **Google OAuth client setup** — needs a client id/secret with the instance callback URL registered before this can be verified against real accounts; use the dev-email bypass mode for automated tests.

## Notes

- **Real Google OAuth is unverified.** No Google Cloud OAuth client exists for this instance yet, so `/auth/callback`'s allowlist/session-minting logic is exercised only against a fake `GoogleAuth` verifier (tests) and the `DEV_ADMIN_EMAIL` bypass (tests + the browser walkthrough) — never a real `accounts.google.com` round trip. Operator steps to enable it for real, once ready:
  1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application) for the project.
  2. Add an Authorized redirect URI of `<PUBLIC_URL>/auth/callback` (exactly; no trailing slash).
  3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_SECRET` (any ≥32-byte random string; e.g. `openssl rand -hex 32`), `PUBLIC_URL`, and `OAUTH_ALLOWED_EMAILS` and/or `OAUTH_ALLOWED_DOMAINS` in the deployed environment (Cloud Run env vars / secrets, per whatever `tf/` module provisions this instance — no dedicated Terraform var for these existed before this plan; they're plain `@fastify/env` vars today).
  4. Leave `DEV_ADMIN_EMAIL` unset in that environment (and it's ignored outright when `NODE_ENV=production` regardless).
- **Found and fixed a routing bug in already-merged code.** `routes/static.ts`'s SPA-shell prefix list only registered `/admin/*`, which does not match the bare `/admin` path — exactly the dev-bypass login's default return path — so it 403'd via the gateway's default-deny instead of serving the SPA shell. Fixed by adding `/admin` alongside `/admin/*`.
- **Bundle sharing.** `routes/participant/bundle.ts` now exports `buildParticipantBundle()`, used by both the participant `/i/:token/api/bundle` route and the new admin `GET /admin/api/documents/:slug/participations/:person/bundle` (view-as) route, so the two can't drift on shape. The admin route deliberately does *not* apply the participant route's "hide a still-`draft` document" restriction — previewing a person's view before opening is exactly what view-as is for.
- **View-as "every control disabled"** was implemented by omitting interactive elements entirely — a `readOnly` prop threaded through `DocumentView` → `DocumentHeader`/`IdentityLine`/`VersionLabel`/`Footer`, plus a new `ReadOnlyStatusCard` standing in for the interactive `StatusCard` — rather than rendering live controls with a `disabled` attribute. Simpler to reason about and to test (zero enabled controls, full stop), at the cost of the participant `Signatories`/`SubmissionsSection` components' own non-mutating disclosure toggles ("show all", the drafts `<details>`) not being wired for it — they aren't in the Actions table, so left alone.
- **Rebased onto `origin/develop`** after PRs #18 (single-version compare fix) and #19 (README) merged ahead of this branch. One real conflict, in `VersionLabel.tsx` — both plans touched the "See what changed" link's visibility (v1 gate vs. `readOnly` gate); resolved by nesting both conditions rather than picking one side.
- `jose` (already the `jarvus-fastify` skill's recommended JWT library) was added to `apps/api` for Google id_token verification against Google's published JWKS — no `google-auth-library` dependency, unlike the `proposal-renderer` reference this plan was modeled on.

## Follow-ups

- Issue [#21](https://github.com/JarvusInnovations/community-drafter/issues/21) — extend-deadline activity entries should carry the literal old/new deadline timestamps, not just which fields changed (the unchecked half of the last Validation item).
