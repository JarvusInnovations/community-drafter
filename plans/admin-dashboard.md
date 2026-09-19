---
status: planned
depends: [participant-sign-flow, comment-mode]
specs:
  - specs/screens/admin-dashboard.md
  - specs/behaviors/access-and-identity.md
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

- [ ] An email outside the allowlist is refused at `/auth/callback`; an allowed one lands on `/admin` with a session that expires in 24 h.
- [ ] A cookie-authenticated request and a bearer-authenticated request are never accepted together, and a request presenting both an `Authorization` header and a session cookie resolves via bearer only (deferred from `api-core`, PR #10 — the gateway's transport-resolution order).
- [ ] A cookie-authenticated POST without the CSRF header is rejected; with it, succeeds.
- [ ] People table filters are in the URL and survive reload; no token appears in any rendered page except after the explicit copy/export action, which appears in activity.
- [ ] Submissions page shows a draft only under the "Unsubmitted" group and never renders a comment detached from its submission (component test).
- [ ] View-as renders the participant page with every control disabled and the banner present.
- [ ] Extend deadline with an earlier time shows the `deadline_not_later` message; a later time appears in activity with old and new times.

## Risks / unknowns

- **Google OAuth client setup** — needs a client id/secret with the instance callback URL registered before this can be verified against real accounts; use the dev-email bypass mode for automated tests.

## Notes

(closeout)

## Follow-ups

(closeout)
