# Behavior: Sites

## Rule

One deployment serves many hostnames. A **site** is one hostname and the identity carried on it: a name, a sender, an optional logo and accent, and the group of operators who work there. Every document belongs to exactly one site, and every surface that document shows a participant or the public — page, link, message, embed — carries that site's identity and no other.

A **default site** is derived from the deployment's own configuration rather than from a record. It owns every document that names no site, so an instance that has never created a site behaves exactly as it does today and nothing needs migrating.

A site is also the tenancy boundary: an operator sees the documents, the operators and the people of the sites they belong to, and nothing else.

## Applies To

Every participant route (`/i/<token>/…`), public and embed route (`/d/<slug>/…`), admin route (`/admin/…`) and auth route (`/auth/…`); every outbound message; `screens/document.md`, `screens/public-and-embed.md` and `screens/admin-dashboard.md`; `api/admin.md`, `api/admin-cli.md` and `api/auth.md`; the `people` sheet and every lookup of a person (§ People are per site); the hostnames declared in `tf/` and the onboarding procedure in `docs/operations.md`.

## The site record

One record per hostname in the `sites` sheet (`data-model.md`). Managed only through the admin API and CLI, so the service stays the single writer.

| Field | Type | Notes |
| --- | --- | --- |
| `slug` | slug | identity; the path; never changes. `default` is reserved for the deployment's own site and may not be taken |
| `hostname` | lowercase host name | the hostname this site answers on: no scheme, no port, no path. Unique across sites |
| `name` | string | what the top bar, the footer and every message call this site |
| `sender_name` | string? | default display name for mail from this site's documents |
| `sender_email` | email? | the address mail is sent **From**, when the operator has verified it with the mail provider; absent means the platform's own verified address is used (§ Mail) |
| `reply_to` | email | default Reply-To for this site's documents |
| `logo_url` | https URL? | shown on this site's web surfaces in place of the site name (§ Identity on a surface) |
| `accent` | color token? | the site's primary color: **one token**, overriding the accent color of `screens/document.md` § Design and nothing else. Not a theme object; a site that wants more than one color wants a design pass, not a field |
| `operators` | array of email | the site's operator group; never empty |
| `created_by` | email | the operator who created the site |

Who created, changed or deleted a site, and when, is the history of the record (`Action: site-create`, `site-update`, `site-remove`, `site-operator-add`, `site-operator-remove`, with a `Site` trailer).

**A site has exactly one hostname.** A customer who owns two domains gets one site on the one they want their signers to read, and points the other wherever they like outside this service; nothing here mints a link on a second host, and nothing has to decide which of two names is the real one. Two sites may not claim the same hostname either, so hostname and site are a bijection and resolution never has an order to get wrong.

A site record carries no DNS, no certificate and no deployment state. It is the identity; the hostname is routed to the service separately (§ Onboarding a hostname).

## The default site

The default site is not a record. Its fields are read from the deployment's configuration:

| Field | Value |
| --- | --- |
| `slug` | `default` |
| `hostname` | the host of `PUBLIC_URL` |
| `name` | `INSTANCE_NAME`, falling back to `Signatories` |
| `sender_email` | `INSTANCE_FROM_EMAIL` — the platform's verified address |
| `reply_to` | `INSTANCE_FROM_EMAIL` |
| `sender_name`, `logo_url`, `accent` | unset |
| `operators` | every active operator who belongs to no other site's group, plus every superadmin |

It is the site of every document whose `site` field is absent, and the site of any request whose host matches no record. It cannot be created, renamed or deleted through the API; it changes when the deployment's configuration changes.

The default site is the **platform's own site**. The platform is **Signatories**, at `signatories.org`; the marketing site lives there, and the service's own hostname is the default site's. A customer's site is never the default site, and a customer hostname CNAMEs to `sites.signatories.org`, an alias the platform maintains in its own zone (`docs/operations.md` § Onboarding a site).

Its operator group is derived, not stored, and that derivation is what closes the instance-wide operators directory (issue #50) with no migration: on an instance with no sites, every operator is in the default group, which is today's behavior exactly; the moment an operator is added to a site's group they leave the default group and the two groups stop seeing each other.

## Resolving a site from a request

Every request resolves to exactly one site, before routing:

1. Take the host the request was addressed to, lowercased, with any port removed.
2. Exact match against `sites.hostname` → that site. Matching is exact: no wildcards, no suffix matching, no path prefixes.
3. No match → the default site.

Two records claiming one hostname is a validation failure on write, never a resolution order.

Resolution trusts the host the request was addressed to, and deliberately does no more: a forged `Host` on the service's own bare URL changes which name and color are drawn and nothing else, because a token is still rejected unless its `site` matches and a document still redirects to its own hostname before it renders (§ Operators and tenancy, § The document's site is canonical).

Everything that reads `PUBLIC_URL` or `INSTANCE_NAME` today reads the resolved site instead — with one exception that matters more than the rule: **a personal or public link is always minted on the document's site**, never on the site the request arrived at (§ The document's site is canonical). A send triggered from the admin of one host still mails links on the document's own host.

## The document's site is canonical

A document's `site` names the only hostname its participants are ever sent to.

- A request for `/d/<slug>…` or `/i/<token>…` whose resolved site is not the document's site is answered with a **302** to the same path and query on the document's site hostname over https. Temporary, not permanent: a document's site can be changed by an operator, and a cached permanent redirect would outlive the fact.
- The redirect discloses nothing. A public slug is already public, and a personal link is its own credential that travels in the path either way; moving it between two hostnames of one deployment puts it in front of no one new ([The link is the identity](../principles.md#the-link-is-the-identity)).
- A slug or token that does not resolve is the existing "isn't available" 404 on whatever host it was asked on, with no redirect and nothing that distinguishes a wrong host from an unknown document.
- Embed and widget routes (`/d/<slug>/embed`, `/signatories`, `.json`, `widget.js`) redirect on the same terms; a host page that embeds the canonical hostname never sees a redirect at all.
- `/admin/…` and `/auth/…` never redirect. They are per-host by design (§ Operators and tenancy).

This redirect is the only route behavior that crosses sites. Nothing on a site's surface links to another site, names one, or reveals that another exists.

## Identity on a surface

On every participant and public surface the resolved site supplies the identity that `INSTANCE_NAME` supplies today:

- The top bar shows the site's `name`, or its `logo_url` image in place of the name when one is set; the accessible name is the site's `name` either way.
- The footer's private-link line and the "Questions? Email the team" address are the site's, through the document (`screens/document.md` § Display Rules 8).
- `accent`, when set, replaces the accent color token; every other token in `screens/document.md` § Design is fixed. A site cannot supply a layout, a typeface or a stylesheet.
- Messages name the site (§ Mail).

No surface carries the platform's name, domain, logo or a "powered by" line. The platform's own identity belongs to the platform's own site.

## Operators and tenancy

This section replaces the instance-wide operators directory and closes issue #50. An operator **record** stays one per email, instance-wide; the **group** is a list on the site, exactly as a document's operators are a list on the document.

- **Creating a site, changing its identity and deleting it are superadmin actions**, because each is tied to infrastructure the platform team has to provision anyway (§ Onboarding a hostname). Managing a site's **operator group** is not: any operator of the site may add or remove members of it.
- `sites.operators` is the site's operator group. One person may be in several groups; a superadmin is in every group. The **default site's** group is derived, not stored, so nothing writes to it: an operator joins it by belonging to no other site's group, and leaves it by joining one.
- The operators directory — `GET /operators`, `/admin/operators`, `operators list` — returns the resolved site's group and nothing else.
- Creating an operator adds the email to the resolved site's group in the same commit, creating the record if the email is new: one commit, `Action: operator-add`, whose `Site` trailer names the group joined.
- An operator may update or deactivate only an operator in a group they share; any other email is 404, the same body as an unknown operator, so the directory cannot be used to enumerate across sites.
- **Removing someone from a site is not deleting them.** `sites operators remove` drops the email from that site's group; the record, and their membership of other sites, is untouched. Deleting the record itself is a superadmin action, because the record is instance-wide.
- A group is never emptied: a removal that would leave a site with no operators, or leave one of that site's documents with no operator, is refused.
- The add-operator picker on a document draws from the **document's site's** group, and `docs operators add` refuses an email outside it.
- `GET /documents` returns the documents of the resolved site that the caller operates. A superadmin on the default site's host sees every document on every site, each labeled with its site; this is today's superadmin behavior unchanged.
- A document is created on the caller's resolved site unless it names another site the caller is an operator of. Naming a site they do not operate is 404, like any other cross-tenant read.
- A document may be moved to another site the caller operates. Its slug, links and history do not change; the hostname its participants are sent to does, from the next message and the next redirect.

**Sessions are per host.** An operator signs in on the hostname they will work on. The session cookie is host-only already (it carries no `Domain`), and a CLI token names the site it was minted on; presented to another site's host it is 401 `unauthenticated`, the same as no credential at all. A magic link is built on the host the sign-in was requested on, and a device code is approved on that same host. Someone who works on two sites signs in twice and keeps one CLI profile per site.

Nothing here changes what a superadmin may do, and nothing changes how an action is attributed: the `Actor` trailer is the operator's email on every site.

## People are per site

A **person belongs to one site**, the same way a document does. The `people` sheet is keyed `${{ site }}/${{ id }}` (`data-model.md` → `people`), and every lookup of a person is scoped by the site of the document being read or written.

- **Email is unique within a site, not across the instance.** The same address invited on two sites is two independent records with two ids, two sets of defaults and no link between them. Neither site can see, read or edit the other's.
- **Within a site, documents share the person.** Correcting a name or an organization once fixes it for every document on that site — which is the reason the record is not per document.
- **What a particular document prefills is not on the person**; it is `prefill` on that document's participation (`data-model.md` → `participations`). This is what stops an import on one document from changing what another document's sign card offers (issue #51).
- **The scope follows the document, not the caller.** A person is resolved through the site of the document in hand, so an operator of one site never reads another's contacts, and a superadmin reaches every site's people only because they reach every site's documents — no lookup widens for them. There is no endpoint that lists people across sites, and adding one would be a lobby ([One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby)).
- **Nothing from `people` reaches a participant or public surface** except the resolved sign-card prefill, exactly as before.

Records written before people had a site are migrated to the default site in one boot-time commit (`data-model.md` § Migrating the pre-site layout). This is the one place a site change needs a migration: a document with no `site` reads as the default site with no rewrite, but a person's site is a path component, so the file has to move.

## Mail

One mail provider account, one API key, many sites. The provider will accept a message only if its `From` is a sender or a domain that account has verified, so the From line is chosen per message:

- **When the document's site has `sender_email`**, the message is sent From it. The operator is responsible for having verified that address or its domain with the provider (§ Onboarding a hostname).
- **When it does not**, the message is sent From the platform's own verified address with the site's `name` as the display name, so the reader sees the site and the provider sees an address it trusts.
- **Display name**: the document's `sender_name`, else the site's `sender_name`, else the site's `name`.
- **Reply-To**: the document's `reply_to`, else the site's `reply_to`. A document's own values always win; the site supplies the default a document may omit.
- **Every link in the message** is on the document's site hostname.
- **Every message carries the site's slug as a provider tag**, so per-site delivery statistics exist without a per-site account.
- `operator-magic-link` is not about a document: it is sent from the **resolved** site, names that site, and links to that site's host.

**An unverified sender fails; it never silently becomes something else.** A message the provider rejects is a delivery failure per recipient on the existing path (`notifications.md` § Sending, and § "A sent count is a delivery count"): nothing enters `notified`, no `sent_at` is written, the operator is told which recipients failed and why, and the next send picks them up. The service never falls back to the platform address for a site that declared one — an operator whose DNS is not finished must see that, not discover months later that their statement went out under someone else's name.

Messages carry no logo and no header image on any site (`notifications.md` § Shape). `logo_url` is a web-surface identity only.

## What a site is not

- **Not a deployment.** One Cloud Run service, one data repository, one read model, one writer. Sites are rows, not stacks.
- **Not a lobby.** No site host lists documents, sites or operators outside the caller's own scope ([One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby)).
- **Not DNS.** Creating a record routes nothing: the hostname reaches the service only once it is verified to the project and mapped (§ Onboarding a hostname). A record whose hostname is not yet mapped is inert, and every surface that prints it says so rather than implying a live address.
- **Not an access control on participants.** `audience`, `public_access` and `show_signatories` are unchanged and answer their own questions (`data-model.md` § Audience).

## Onboarding a hostname

Four steps, in order, described for an operator in `docs/operations.md`:

1. **Verify ownership of the domain** — the base domain is verified as a Search Console domain property by adding the `google-site-verification` TXT record it prints, and every identity that will create a mapping for it — the person applying `tf/` by hand and the CI service account alike — is listed as a verified owner of that property. Verification belongs to an account, not to a project, so the identity running the apply is the one that has to hold it. Required before a mapping can be created at all.
2. **Map the hostname** — add it to the deployment's list of site hostnames and apply (`tf/`, `plans/site-hostnames.md`).
3. **Point DNS at the service** — the customer adds the CNAME to `sites.signatories.org`, the platform's own alias for Google's endpoint. The certificate provisions on its own once the record resolves.
4. **Create the site record** — `sites create`, which prints, in one block, every DNS record the customer must add: the CNAME for the hostname, and, when `--sender-email` is given, the two records the mail provider requires (a DKIM TXT record and a Return-Path CNAME), whose values come from the provider's console.

Steps 2 and 4 are deliberately separate systems. The record is data an API key may write; the mapping and the certificate are infrastructure it may not ([A site record never moves DNS](#principles), below).

## Principles

**Inherited**

- [One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby): more hostnames is not more surface. Each site host shows only what its own scope contains, and no host indexes documents, sites or other operators.
- [The link is the identity](../principles.md#the-link-is-the-identity): a participant crossing from one hostname to the canonical one is never asked to prove anything; the token is still the whole credential.
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): a site is a record and its changes are commits; the certificate and the DNS zone behind it are not, and deliberately live where a leaked API key cannot reach them.

**Local**

- **A site is the only identity a participant ever sees.** Every word, address and link on a participant or public surface belongs to the document's site: the name in the top bar, the From line, the Reply-To, the hostname in the URL, the footer. The platform's own name, domain and default sender exist for operators and for the platform's own site; they never appear on another site's surface. This rules out a "powered by" line, a platform logo in a message, a link back to `signatories.org`, a cross-site link of any kind, and — the one an implementer will reach for without noticing — a personal link minted on whichever host the request happened to arrive at.

  *Why:* a coalition asks people to put their name on a statement. A name they do not recognize anywhere in that transaction is a reason to close the tab, and a second name beside the first is a reason to wonder who is really collecting this.

- **A site record never moves DNS.** Nothing an operator can do through the API or the CLI creates, changes or removes a domain mapping, a certificate or a DNS record. The record declares an identity for a hostname someone has already routed; when the two disagree, the surface says so and neither one is repaired automatically. An implementer tempted to call the platform's API from a request handler to "finish" a site should not.

  *Why:* the credential that writes records is held by a running web service on behalf of every operator on the instance. The credential that can repoint a customer's domain should not be reachable from an HTTP request at all.
