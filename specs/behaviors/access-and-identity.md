# Behavior: Access and Identity

## Rule

Access to a document is granted by links, not accounts. A **personal link** binds one person to one document and is the only credential an invited participant ever needs. A **public link** exposes a document read-only to anyone who has it, and **[phase 2]** lets a visitor mint their own personal link by verifying an email address.

## Applies To

All participant routes, public routes, the admin API's invitation and link-export actions, invitation emails.

## Personal links

- URL shape: `https://<the document's site hostname>/i/<token>`. The token is the only variable part so links stay short enough for SMS and never disclose the document slug. The host is the document's **site**, never the host a request happened to arrive on and never the deployment's own URL (`behaviors/sites.md` § Resolving a site from a request); on an instance with no sites that host is the default site's, which is `PUBLIC_URL`'s, exactly as before.
- Token: at least 96 bits of randomness encoded base62 (16+ chars), minted server-side when the participation is created, unique across the instance, stored on the `participations` record, indexed for lookup, compared in constant time.
- Resolution: unknown, `link_revoked`, or `expires_at` passed all render the same "This link isn't available" page (HTTP 404) with a generic contact line. Existence is never disclosed. A token that resolves on a host that is not its document's site is redirected to the canonical host with its path and query intact; an unknown token is the same 404 on every host, so a wrong host is indistinguishable from a wrong token (`behaviors/sites.md` § The document's site is canonical).
- A resolved link is **both** identity and authorization for every participant action on that document: read, sign, revoke, draft, submit, preferences. Sub-routes carry the token in the path (`/i/<token>/history`, `/i/<token>/prefs`, `/i/<token>/api/…`). No cookie is required or set for participants in phase 1.
- Every participant page shows who the link is bound to ("You're here as **Jane Doe**") with a "Not you?" affordance that explains the link was personal and how to ask the team for their own. It does not let the visitor rename themself.
- Every signature and revocation triggers a confirmation email to the bound person's address (see `notifications.md`). This is the detection and correction path for a forwarded link.
- Tracking: first open sets `first_opened_at`; each page view updates `last_seen_at` and increments `opens` (batched writes, see `architecture.md`). Opens are not shown to participants.
- Revocation: admin revokes a link (e.g. reported forwarded) and may mint a replacement; a replacement is the same participation record with a new `token`, so signature, comments and preferences are untouched.

## Why a share table, not a signed token

Personal links are fields on a record, not self-contained signed payloads (JWT), because:

- they must be **revocable** individually without rotating a secret;
- they must be **tracked** (opened, acted) and that needs a row per link anyway;
- they must be **short** for SMS and email clients;
- the identity they bind changes over time (a corrected name, an added org) and must not be frozen into the URL.

A signed token adds nothing the record does not already provide.

## Public links

- URL shape: `https://<the document's site hostname>/d/<slug>` when `public_access` is `read` or `participate`; 404 otherwise. Asked for on another site's host, it redirects to the canonical one; a public slug is public, so the redirect discloses nothing (`behaviors/sites.md`).
- Renders the current version, the clock, the version history and the signatory list (per `show_signatories`), with no sign or comment controls in phase 1. A "want to sign? ask the team for your link" line is shown, with the document's `reply_to`.
- Embeddable variants live under `/d/<slug>/…` (see `screens/public-and-embed.md`). Personal links are never embeddable: framing a personal link on a public page would leak a credential.
- A personal link is never previewable either: the HTML at `/i/<token>/…` carries the generic instance metadata a scraper may see, never the document's title (`screens/public-and-embed.md` § Share Preview). Pasting a personal link into a chat hands its preview to everyone in the room.
- **[phase 2] participate.** The public page offers "Sign or comment": the visitor enters name and email, receives a magic link, and following it mints a `people` record (if new by email) and a participation with `source = public`, then redirects to that personal link. Magic links expire in 30 minutes and are single-use. Signatures from `public` invitations start with `display_approved = false` and appear in counts and lists only after an admin approves them.

## Admin access

Admins are **operators**: see `behaviors/operators.md` for who they are, how they sign in (emailed magic link; device-code flow for the CLI), how sessions work (signed tokens checked against the live operator record), and how access is scoped to documents. In short:

- **Dashboard (human):** magic-link sign-in, 24-hour signed session cookie, CSRF header on writes. Sessions are per hostname: an operator signs in on the site they work on (`behaviors/sites.md` § Operators and tenancy).
- **CLI and bots:** a 90-day signed token obtained through the device-code flow, sent as `Authorization: Bearer`. Bots are operators with their own email.
- There is no instance-wide credential. The operator's email is recorded as the `Actor` of every admin-originated commit.
- Operators may open any participant page **as** a participant only through an explicit "view as" action that renders the page read-only with a banner; admins never act on a participant's behalf through the participant UI. Administrative fixes (e.g. revoke a signature at the person's emailed request) go through the admin API and are attributed to the admin.

## Details

- Rate limiting: token resolution failures are limited per source address (e.g. 30/min) to blunt enumeration; success paths are not limited.
- Tokens are never logged in full; logs show the first 4 characters.
- The admin "links export" action is the only way to read tokens back after creation, and it is recorded as an admin event with the count exported.

## Principles

**Inherited**
- [The link is the identity](../principles.md#the-link-is-the-identity): no login for invited people; forwarded-link risk handled by visibility and confirmation email, not by authentication.
- [One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby): a token reveals nothing about other documents; there is no route that lists documents outside admin. More hostnames adds no such route either.

Which host a link is built on is governed by `behaviors/sites.md` § Principles, "A site is the only identity a participant ever sees".

**Local**
- **Identity is the person, not the link.** Everything a participant does is keyed by `person`, so tokens can be revoked and reissued without losing anything. An implementer tempted to key a signature or draft by token instead should not.
