---
status: planned
depends: []
issues: [50]
specs:
  - specs/behaviors/sites.md
  - specs/data-model.md
  - specs/behaviors/access-and-identity.md
  - specs/behaviors/operators.md
  - specs/behaviors/notifications.md
  - specs/screens/document.md
  - specs/screens/public-and-embed.md
  - specs/screens/admin-dashboard.md
  - specs/api/admin.md
  - specs/api/admin-cli.md
  - specs/api/auth.md
  - specs/api/participant.md
  - specs/architecture.md
---

# Plan: sites

## Scope

Whitelabel one deployment across many hostnames, in the application: the `sites` sheet, the derived default site, host→site resolution, canonical-host redirects, per-site identity on every participant and public surface, per-site mail, per-site operator scoping (which closes #50), and the `sites` commands and admin pages.

**In:** everything in `specs/behaviors/sites.md` that a request, a record or a screen can do.

**Out:** the Cloud Run domain mappings, the `tf/` variable and the operator runbook — [`site-hostnames`](site-hostnames.md), which depends on this one. Also out: sharing person records across documents (#51, per-document `people` prefill), automating Postmark sender verification through its Account API, and anything about the platform's own name or domain, which is undecided.

A hostname does not reach this service until `site-hostnames` lands, so everything here is validated on the default site plus a hosts-file or `Host:`-header override until then. That is a real limit, not a shortcut: the resolution rule takes the host from the request, so a local test that sets `Host` exercises the same code path production will.

## Implements

- `specs/behaviors/sites.md` in full: the site record, the derived default site (including its operator group — "every active operator who belongs to no other site"), host resolution, the 302 to the document's canonical host for `/d/…` and `/i/…`, identity on a surface, tenancy, mail, and the two local principles.
- `specs/data-model.md`: the `sites` sheet (sixth sheet), `documents.site`, the `Site` trailer, the four new `Action` values, and the note that an operator record is instance-wide while membership is a list on the site.
- `specs/behaviors/access-and-identity.md`: links are built on the document's site; a token on the wrong host redirects, an unknown token 404s identically on every host.
- `specs/behaviors/operators.md`: the directory, creation, update and removal scoped to the resolved site's group; removal-from-site versus superadmin-only record deletion; per-host sessions and magic links; the bootstrap operator belongs to the default site.
- `specs/behaviors/notifications.md`: From address, display name, Reply-To and provider tag resolved per § Mail; an unverified sender is a per-recipient delivery failure, never a substitution.
- `specs/screens/document.md` and `specs/screens/public-and-embed.md`: the site bar (name or logo), the accent override, the footer's reply-to, and the redirect on non-canonical hosts.
- `specs/screens/admin-dashboard.md`: the per-site operators page, the superadmin Sites page with verification hints, the document list scoped to the site, the dashboard's Site line, and the frame reading `session.site`.
- `specs/api/participant.md`: the bundle carries the document's `site` (name, logo, accent) in place of `instance`.
- `specs/api/admin.md` § Sites and the scoping paragraph; `specs/api/auth.md`'s `site` claim and `session.site`; `specs/api/admin-cli.md`'s `sites` commands, `--site` on `docs create` / `docs update`, and the site in every document view.

## Approach

1. **Record and read model.** `.gitsheets/sites.toml` is already on this branch; add `sites` to the init/sync sheet list and to `packages/shared`'s record types, and add `site` to the document record type. Index sites by hostname and by slug in the read model, and compute the default site once at boot from `PUBLIC_URL` / `INSTANCE_NAME` / `INSTANCE_FROM_EMAIL`. The default site's operator group is derived on read (active operators in no site's group, plus superadmins), never written.
2. **Resolution before routing.** One `onRequest` decoration — `request.site` — resolving host → site with the default as fallback, registered ahead of the auth gateway so everything downstream (including error paths) has it. Nothing else reads `PUBLIC_URL` afterwards; the helpers in `apps/api/src/notifications/links.ts` take a site instead of a base URL, and `apps/api/src/routes/admin/invitations.ts`'s `publicLink`, `apps/api/src/notifications/context.ts`, `apps/api/src/routes/participant/bundle.ts` and `apps/api/src/auth/routes.ts` follow.
3. **Canonical-host redirect.** A single guard on the `/d/:slug` and `/i/:token` route families: resolve the document (or the token's document) first, compare its site to `request.site`, 302 with path and query preserved when they differ, and fall through to the existing 404 when nothing resolves — so the wrong-host and unknown-document answers stay identical.
4. **Auth.** `site` claim on every minted token; reject a mismatch as `unauthenticated` in the gateway, not per route. Magic links and device-approval URLs built from `request.site.hostname`. `GET /auth/session` returns the `site` object; the web frame and `apps/web/src/admin/copy.ts` follow, replacing `instance_name`.
5. **Tenancy.** Scope `GET /documents`, `GET /operators`, `POST /operators`, `PATCH /operators/:email` and the document-operator picker to the resolved site's group; make `DELETE /operators/:email` superadmin-only; add the `/sites` endpoints, each committing with a `Site` trailer. The group-emptying and last-operator refusals live beside the existing `last_operator` check.
6. **Mail.** One `resolveSender(document, site)` used by every send: From address, display name, Reply-To, tag. No fallback from a declared-but-unverified sender — the provider's rejection travels the existing failure path untouched.
7. **Web.** The site bar (logo or name), the accent token bound from the site, the admin Sites page, the per-site operators page, and the Site line on the dashboard. The accent is a CSS custom property set on the document element from the bundle/session; nothing else in the token set moves.
8. **CLI.** `sites list|show|create|update|operators`, `--site` on `docs create` and `docs update`, the site and canonical host in every document view, the DNS block printed by `sites create`, the home view's identity line naming the site, and the generated `SKILL.md` Sites section. Rebuild the bundle in its own commit per `axi-skills`.
9. **Tests.** Resolution, redirects, scoping, sender selection, and the default-site fallbacks (an instance with no `sites` records must behave exactly as it does today) — the last is the regression that matters most.

## Validation

- [ ] With no `sites` records, every existing test passes unchanged and a document's links, mail and top bar are byte-identical to before: the default site is genuinely today's behavior.
- [ ] A document on a site with hostname H: its personal link, public link, every link in every message, and the `docs show` output all name H, whichever host the request or the send was made from.
- [ ] `GET /d/<slug>` and `GET /i/<token>` on the wrong host 302 to H with path and query intact; an unknown slug and an unknown token return the same 404 on every host, with no way to tell a wrong host from a wrong document.
- [ ] A site with a verified `sender_email` sends From it; a site without one sends From the platform address with the site's name as display name; a site whose `sender_email` the provider rejects produces named per-recipient failures, no `notified` entries and no `sent_at`, and the next send reaches those recipients once verification lands.
- [ ] Two operators on two different sites: each sees only their own site's directory and documents; `docs operators add` refuses the other site's email naming the site; `DELETE /operators/:email` is 403 for a non-superadmin; removing an operator from one site leaves their other membership intact. #50 is closed by this PR.
- [ ] A CLI token minted on one site's host is 401 on another's; a session cookie set on one host is not sent to another; a magic link requested on a site's host arrives naming that site and lands on that host.
- [ ] A site with `logo_url` and `accent` shows both on the participant and public surfaces at 390 px and 1280 px (screenshots on the PR); messages from that site carry no logo.
- [ ] `sites create --sender-email …` prints one block containing the hostname CNAME and both Postmark records, and states that the record routes nothing.
- [ ] A superadmin's Sites page lists every site with its effective From line and honest verification states.

## Risks / unknowns

- **`Host` spoofing.** Resolution trusts the host the request was addressed to. Behind Cloud Run that is the mapped hostname, but a direct request to the service's own `run.app` URL with a forged `Host` would resolve to a site. It grants no authority — a token from another site is still rejected and a document still redirects to its canonical host — but the identity shown could be wrong; decide during implementation whether to pin resolution to the set of mapped hostnames.
- **Default-group derivation.** "Every active operator in no other site's group" is cheap to compute and has no migration, but it means adding someone to their first site silently removes them from the default directory. That is the intent; it will still surprise someone the first time.
- **`accent` as one token.** If the spec's `[decide]` resolves toward a small theme instead of one color, the web work in step 7 grows; nothing else does.
- **Scoping regressions are invisible.** A missed scope check does not fail loudly — it shows another tenant's data. Every list endpoint needs a two-tenant test, not a single-tenant one.
- **Bundle drift.** The CLI bundle must be rebuilt and committed separately, or CI's drift gate fails the PR.

## Notes

(At closeout.)

## Follow-ups

(At closeout.)
