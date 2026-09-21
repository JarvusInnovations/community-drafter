# Behavior: Operators and Admin Authentication

## Rule

The people who run documents are **operators**. There is no platform-wide role: an operator can create documents, and can act on a document only if they created it or were added to it by one of its current operators. Operators are also scoped by **site** (`behaviors/sites.md`): the directory an operator reads, the people they may add to a document, and the documents they may list are those of the site whose hostname they signed in on. The instance owner administers operators through the same API and CLI as everyone else, and can always read the data repository directly. Operators are identified by email address, sign in with an emailed magic link, and hold sessions that are self-contained signed tokens checked against the live operator record on every request.

## Applies To

Every `/admin/*` and `/auth/*` route, the admin CLI, the admin dashboard, the `Actor` trailer on every admin-originated commit, bot accounts. Scoping by site is `behaviors/sites.md`; this spec says what an operator is and how they sign in.

## Operators

- One record per operator in the `operators` sheet (`data-model.md`): email (merge key), name, `kind` (`person` | `bot`), `active`, optional `title` and `org`, notes. The record is instance-wide; which sites the operator belongs to is the `operators` list on each `sites` record, not a field here (`data-model.md` § `operators`).
- **Any active operator may create a document**, on a site they belong to. The creator becomes its first operator (`documents.created_by`) and is listed in `documents.operators`.
- **Any current operator of a document may add or remove operators on it**, drawing only from active operators **in that document's site's group**. A document always keeps at least one operator; removing the last one is refused.
- **Bots are operators.** An unattended agent gets its own operator record (`kind: bot`) with its own mailbox, signs in once by a human clicking its magic link, and thereafter acts under its own identity. Nothing acts "as" a person through a label header.
- **Operator management is a normal admin action**: create, update (name, title, org, notes, `active`), and remove go through the admin API and CLI so the service stays the single writer of the data repository. Every change is a commit (`Action: operator-add | operator-update | operator-remove`, `Actor` = the operator who did it). Only an existing operator of the site may create operators; there is no self-registration. Creating one adds the email to the caller's site group in the same commit, and an operator may update or deactivate only an operator in a group they share — any other email answers 404, the same body as an unknown operator, so the directory cannot be used to enumerate across sites.
- **A new operator is told they exist.** Creating an operator record mails that person, naming the instance, who created the account, and the `/admin` address they sign in at; adding an operator to a document mails them the document and its dashboard address (`notifications.md` § Messages, `operator-added` and `operator-added-to-document`, and § Operator mail for what those messages are and are not). Neither is sent to the operator who performed the action. Access arrives with an address to use it at, or the person has to be told out of band and the instance URL travels by word of mouth.
- **Removing someone from a site is not deleting them.** Dropping an email from a site's group (`Action: site-operator-remove`) leaves the record and every other membership intact; deleting the record itself is a superadmin action, because the record is instance-wide (`behaviors/sites.md` § Operators and tenancy). This is the scoping issue #50 asked for: one directory per site, no cross-site edit, no cross-site Remove button.
- **Deactivating** an operator (`active = false`) or removing them ends their access everywhere at the next request, because authorization is resolved from the record, not from the token.
- **Bootstrap.** When the `operators` sheet is empty at boot and `BOOTSTRAP_OPERATOR_EMAIL` is set, the service creates that operator (`kind: person`, `active: true`) in a commit attributed to `system`. They belong to the default site, which is where the deployment's own hostname resolves (`behaviors/sites.md` § The default site); no `sites` record is written, because the default site is not one. The variable is otherwise ignored. This is the only way the first operator comes into existence.

## Authorization

| Action | Who |
| --- | --- |
| Create a document | any active operator, on a site they belong to |
| Read, publish, invite, export, extend, close, withdraw, revoke links or signatures, view-as, read submissions, dispositions | a current operator of that document |
| Add/remove operators on a document | a current operator of that document |
| List documents | returns only the caller's documents **on the resolved site** |
| Read the operators directory | any active operator; returns the resolved site's group |
| Create a site, change its identity, delete it | a superadmin (`behaviors/sites.md`) |
| Add or remove a site's operators | an operator of that site |
| Create or update an operator | an operator of a site the target belongs to, or a site the new operator is being added to |
| Delete an operator record outright | a superadmin |
| `refresh` the data repository from its remote | the webhook secret, not an operator |
| `init-data-repo` | any active operator (refuses when sheets already exist) |

A request by an operator who is not on the document returns 404 `not_found`, the same body as an unknown document, so document slugs are not disclosed across operators.

A request by an operator for a document on another site returns the same 404, and a document reached on the wrong hostname redirects to its own before any of this is evaluated (`behaviors/sites.md` § The document's site is canonical).

**Superadmins.** An operator record may carry `superadmin: true`. A superadmin belongs to every site's group, sees every document in the list — on the default site's host, every document on every site, each labeled with its site — and passes document scoping everywhere: dashboards, people, submissions, versions, view-as, and adding or removing a document's operators. Nothing else changes: their actions are recorded under their own email like anyone else's. The flag is granted or removed only by another superadmin (`PATCH /operators/:email { superadmin }`; anyone else gets 403 `forbidden`, and nobody can change their own) or by editing the record in the data repo. At boot the operator named by `BOOTSTRAP_OPERATOR_EMAIL`, if it exists and lacks the flag, is made a superadmin in a commit attributed to `system`, so an instance always has one. The operators page shows the flag as a pill; the document list tells a superadmin that they are seeing every document.

**A superadmin acting outside a document's operator list is labeled where it shows.** A document's own operators can enumerate who may act on it (`docs operators <slug>`), so an activity entry written by an account absent from that list otherwise reads as an unauthorized write. Wherever an actor is displayed — the dashboard's activity feed today — an actor who is not in `documents.operators` and whose operator record carries `superadmin: true` is rendered with a `superadmin` label. This changes nothing about authorization or about what is committed: the `Actor` trailer stays the plain email, and the label is derived at read time from the two records. An actor absent from the list *and* not a superadmin is not a case the API permits; if one is ever displayed, it is unlabeled and is a bug in scoping, not in this rule.

## Sign-in: magic link

- The login form accepts any email address and always responds "If that address belongs to an operator, a sign-in link is on its way." No enumeration.
- The address is matched within the **resolved site's** group (`behaviors/sites.md`); an operator who belongs to another site gets the same "if that address belongs to an operator" response and no mail, because on this hostname they are not one.
- If the address matches an active operator, a **magic link** is emailed, built on the hostname the request arrived on and naming that site. Behind it is a signed, single-purpose token valid for 15 minutes, bound to the operator's email and to a random `jti`; the link itself carries only a short random code that maps to that token in memory, so the URL is short and readable. Following it sets the web session cookie and redirects to the requested return path (validated: must start with a single `/`). A used `jti` is remembered in memory until it expires; reuse after a restart within the window is accepted as a known limitation (a restart also forgets pending codes, which simply means requesting a new link).
- Requests are rate-limited per address and per source IP (5 per 15 minutes each).
- The message is transactional (`notifications.md` § `operator-magic-link`): subject "Sign in to *Site name*" — the resolved site's name, which on a deployment with no sites is the instance name — one sentence of context, a button or link, the expiry, and a line to ignore it if not requested. It requires a working mailer; an instance without one cannot sign operators in, by design.

## Sessions: signed tokens, no server-side store

- A **web session** is an HMAC-signed token (JWT, HS256 with `AUTH_SECRET`) in an HttpOnly, SameSite=Lax cookie, 24-hour lifetime, claims: operator email, `kind`, issued-at, expiry, `sid`, and the `site` it was minted on. The cookie carries no `Domain`, so it is host-only already; the claim is what makes a bearer token behave the same way. A token presented to a host whose resolved site is not its `site` is 401 `unauthenticated`, exactly as no credential at all.
- A **CLI token** is the same token shape with a 90-day lifetime and `aud: cli`, delivered by the device-code flow below and stored by the CLI under `~/.config/signatories/<profile>.toml`. Someone who works on two sites signs in twice and keeps one profile per site. The CLI refreshes it silently when it is older than 30 days by calling `POST /auth/refresh` with the current token; a refresh is refused for an inactive operator.
- **Every request** with a token loads the operator record; `active = false` or a missing record means 401, regardless of the token's validity. This is the only revocation mechanism and it is enough: to shut someone out, deactivate the record.
- Cookie-authenticated writes require the `X-Requested-With: drafter` header (CSRF). Bearer-authenticated requests are exempt. A present `Authorization` header is decisive; the cookie is consulted only when it is absent.
- The `Actor` trailer on every admin-originated commit is the operator's email.

## CLI sign-in: device code

1. `signatories-axi login you@example.org` calls `POST /auth/device` with the email and receives a `device_code` (secret, kept by the CLI) and a `user_code` (8 characters, shown to the person), and the server emails the operator a magic link whose return path is `/auth/device?code=<user_code>`.
2. The person (or the bot's mailbox owner) follows the link, which is on the same hostname the CLI was pointed at; the web session is created; the approval page shows the `user_code` and an "Approve this device" button. Approving binds the pending device code to the operator.
3. The CLI polls `POST /auth/device/token` with the `device_code` every 3 seconds for up to 15 minutes; once approved it receives the 90-day CLI token and writes it to the profile. Pending device codes live in memory; a restart before approval fails the login and the CLI says so.
4. `signatories-axi logout` deletes the stored token. `signatories-axi whoami` shows the operator and expiry.

## Data-repository refresh (webhook)

Because the service is the data repository's single writer, changes pushed to the remote from elsewhere are not visible until the service refreshes. `POST /admin/api/refresh`, authenticated by an HMAC signature over the body with `DATA_REPO_WEBHOOK_SECRET` (GitHub's `X-Hub-Signature-256`), makes the service: acquire the write lock, confirm the push daemon has no pending commits (otherwise respond 409 `refresh_busy` and let the caller retry), `git fetch`, fast-forward the local branch to the remote (a non-fast-forward is refused with 409 `refresh_diverged` and logged), rebuild the read model, release the lock. There is no periodic fetch. This is how a hand edit made with `gitsheets-axi` and pushed to the remote reaches the running instance.

## Principles

**Inherited**

- [One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby): document lists are scoped to the caller; cross-operator lookups 404.
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): operators and their document memberships are records; every change to them is a commit with an honest `Actor`.

**Local**
- **A group is a list on the thing, not a flag on the person.** Site membership lives on the `sites` record and document membership on the `documents` record, so one operator record serves every site a person works on and joining or leaving one changes nothing about them.
- **Authorization comes from the record, never from the token.** A token proves who is asking; whether they may act is read from `operators` and `documents.operators` on every request. Nothing about permissions is cached in a claim.
- **Bots are people-shaped in the record.** An agent has its own operator record and email so that attribution, revocation and document membership work identically for humans and bots.
