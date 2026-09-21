# Signatories

*Formerly Community Drafter. Same project, new name; the GCP project, the data repository and a few infrastructure identifiers still read `community-drafter` and are deliberately left alone.*

Community drafting and signing of collective statements: open letters, coalition charters, position papers, anything a group needs to put its name to together.

A small core team publishes a draft. Everyone invited gets a personal link. They open it, read it, and sign their name in one screen. Behind that, and never in front of it, they can leave inline comments, submit them with a position, watch numbered versions land with a one-line changelog, read a redline between any two, and remove their name until a stated deadline. The team runs comments through revision rounds and publishes the final text; the signature list freezes when the clock says so. Every action is a commit in a private git repository, so "how was this statement approved?" always has a real answer.

One instance serves any number of organizations and documents. There is no public homepage: a document is reachable only through the links made for it.

## How a document runs

1. **Publish v1.** The team creates a document and publishes its first version with a summary line.
2. **Open it.** Two deadlines are set: when comments close and when signing closes. The clock is enforced by the server, not by an administrator remembering to flip a switch.
3. **Invite.** People are imported from a CRM export (a gitsheets people sheet exports directly) and each gets a personal link, pre-bound to their identity. No accounts, no logins.
4. **Sign first.** The default path is read → sign. Signing is encouraged from day one because names can be removed until the signing deadline, and signers are always told when the final text lands.
5. **Comment, if they want.** Inline and general comments are saved the moment they are finished, durably, and the team can read them even before they are submitted, always labeled unsubmitted. Submitting attaches a position: sign, sign conditionally, comment without signing, or decline.
6. **Revise.** The team exports the pending feedback, revises, and publishes v2, v3 … each with a changelog line and a disposition per comment. Comments re-attach to moved text and are never dropped silently.
7. **Close.** When signing closes, the signatory list is final: exactly the organizations and individuals listed, in personal or official capacity, with an authorization attestation for the latter. Supporter counts from elsewhere are never blended in.

The full desired behavior lives in [`specs/`](specs/README.md); [`specs/principles.md`](specs/principles.md) is the short version of why it works this way.

## Architecture

- **API**: Fastify 5 on Bun with a deny-by-default auth gateway. Participant credential is the opaque token in the personal link; admins are operators: a bearer token (agents, CLI, via device-code `login`) or a magic-link session cookie (dashboard).
- **Web**: React 19, Vite, Tailwind v4, React Router v7. Participant routes work in email webviews and iframes with cookies and local storage disabled.
- **Storage**: no database. A private git data repository of four flat [gitsheets](https://github.com/JarvusInnovations/gitsheets) sheets (`documents`, `people`, `participations`, `submissions`). Commits are the data model: records hold current state, and every change is a commit whose trailers carry the structured facts. Versions are the document record's body-changing commits; dates, positions and activity feeds are read from `git log`.
- **Admin CLI**: `signatories-axi`, an agent-facing CLI shipped as an installable skill with the bundle embedded. It is the primary admin interface.
- **Deploy**: a single Cloud Run instance (one writer), OpenTofu under `tf/`.

Details and the deliberate departures from the house stacks: [`specs/architecture.md`](specs/architecture.md).

## Repository layout

```
specs/                  what should be true (source of truth)
plans/                  the work DAG that bridges specs to merged code
apps/api/               Fastify API: gateway, storage, rendering, notifications, routes
apps/web/               React SPA: participant, public and admin routes
packages/shared/        record types, markdown render with block ids, redline diff, comment anchors
packages/cli/           signatories-axi source
skills/signatories-axi/ the installable skill (SKILL.md, shim, committed bundle)
tf/                     OpenTofu for the instance
docs/operations.md      runbook: data repo, secrets, deploy, operator sign-in, DNS
```

## Developing

```bash
bun install --frozen-lockfile
bun run lint && bun run format:check && bun run typecheck && bun run test

cd apps/api && cp ../../.env.example .env && bun run dev   # API on :3001, GET /_health
cd apps/web && bun run dev                                 # Vite dev server, proxies the API
```

Tests run against temporary git repositories; nothing needs a database or network. The web build is held to a bundle budget for the participant entry (`cd apps/web && bun run build && bun run check:bundle-size`).

This repo uses spec-driven development: change the spec, then the code, and record the work as a plan in `plans/`. `CLAUDE.md` carries the conventions and the house skills an agent must load before working here.

## Running a document

Install the admin skill into the repo your team (or its agent) works from:

```bash
npx skills add JarvusInnovations/community-drafter --skill signatories-axi
```

Then, with `SIGNATORIES_URL` and `SIGNATORIES_TOKEN` set:

```bash
signatories-axi                                              # every open document at a glance
signatories-axi docs create my-statement --title "…" --owner … --sender-name … --reply-to …
signatories-axi versions publish my-statement --file draft.md --summary "Initial draft"
signatories-axi docs open my-statement --comments-close 2026-10-01T21:00Z --signing-closes 2026-10-08T21:00Z
signatories-axi people import my-statement invitees.ndjson   # merges by email, mints links
signatories-axi people links my-statement --out links.csv    # the only way tokens leave
signatories-axi feedback export my-statement --format md     # the bundle for a revision round
signatories-axi versions publish my-statement --file v2.md --summary "…" --dispositions d.json
```

The skill's `SKILL.md` documents every command.

## Deploying

`docs/operations.md` covers the one-time setup (private data repo and deploy key, Secret Manager entries, optional Postmark, operator sign-in and the CLI login flow, DNS) and both deploy paths: a manual image build plus `tofu apply -concise`, and the release workflow that runs on a GitHub release.

## Status

First release in progress: the participant sign flow, comment mode, versions and redlines, public and embed views, notifications (email via Postmark or an export CSV), the admin CLI skill, and Cloud Run deployment are built. The admin web dashboard is landing last. Phase 2, specified but not built: public participation through emailed magic links, and SMS.

The pilot deployment serves a civic coalition; the tool itself is generic.
