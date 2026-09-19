# Behavior: Operators and Admin Authentication

## Rule

The people who run documents are **operators**. There is no platform-wide role: an operator can create documents, and can act on a document only if they created it or were added to it by one of its current operators. The instance owner administers operators through the same API and CLI as everyone else, and can always read the data repository directly. Operators are identified by email address, sign in with an emailed magic link, and hold sessions that are self-contained signed tokens checked against the live operator record on every request.

## Applies To

Every `/admin/*` and `/auth/*` route, the admin CLI, the admin dashboard, the `Actor` trailer on every admin-originated commit, bot accounts.

## Operators

- One record per operator in the `operators` sheet (`data-model.md`): email (merge key), name, `kind` (`person` | `bot`), `active`, optional `title` and `org`, notes.
- **Any active operator may create a document.** The creator becomes its first operator (`documents.created_by`) and is listed in `documents.operators`.
- **Any current operator of a document may add or remove operators on it**, drawing only from active operators in the sheet. A document always keeps at least one operator; removing the last one is refused.
- **Bots are operators.** An unattended agent gets its own operator record (`kind: bot`) with its own mailbox, signs in once by a human clicking its magic link, and thereafter acts under its own identity. Nothing acts "as" a person through a label header.
- **Operator management is a normal admin action**: create, update (name, title, org, notes, `active`), and remove go through the admin API and CLI so the service stays the single writer of the data repository. Every change is a commit (`Action: operator-add | operator-update | operator-remove`, `Actor` = the operator who did it). Only the instance owner or an existing operator may create operators; there is no self-registration.
- **Deactivating** an operator (`active = false`) or removing them ends their access everywhere at the next request, because authorization is resolved from the record, not from the token.
- **Bootstrap.** When the `operators` sheet is empty at boot and `BOOTSTRAP_OPERATOR_EMAIL` is set, the service creates that operator (`kind: person`, `active: true`) in a commit attributed to `system`. The variable is otherwise ignored. This is the only way the first operator comes into existence.

## Authorization

| Action | Who |
| --- | --- |
| Create a document | any active operator |
| Read, publish, invite, export, extend, close, withdraw, revoke links or signatures, view-as, read submissions, dispositions | a current operator of that document |
| Add/remove operators on a document | a current operator of that document |
| List documents | returns only the caller's documents |
| Create/update/remove operators | any active operator |
| `refresh` the data repository from its remote | the webhook secret, not an operator |
| `init-data-repo` | any active operator (refuses when sheets already exist) |

A request by an operator who is not on the document returns 404 `not_found`, the same body as an unknown document, so document slugs are not disclosed across operators.

## Sign-in: magic link

- The login form accepts any email address and always responds "If that address belongs to an operator, a sign-in link is on its way." No enumeration.
- If the address matches an active operator, a **magic link** is emailed: a signed, single-purpose token valid for 15 minutes, bound to the operator's email and to a random `jti`. Following it sets the web session cookie and redirects to the requested return path (validated: must start with a single `/`). A used `jti` is remembered in memory until it expires; reuse after a restart within the window is accepted as a known limitation.
- Requests are rate-limited per address and per source IP (5 per 15 minutes each).
- The message is transactional (`notifications.md`): subject "Sign in to *Instance name*", one link, no other content. It requires a working mailer; an instance without one cannot sign operators in, by design.

## Sessions: signed tokens, no server-side store

- A **web session** is an HMAC-signed token (JWT, HS256 with `AUTH_SECRET`) in an HttpOnly, SameSite=Lax cookie, 24-hour lifetime, claims: operator email, `kind`, issued-at, expiry, `sid`.
- A **CLI token** is the same token shape with a 90-day lifetime and `aud: cli`, delivered by the device-code flow below and stored by the CLI under `~/.config/drafter/<profile>.toml`. The CLI refreshes it silently when it is older than 30 days by calling `POST /auth/refresh` with the current token; a refresh is refused for an inactive operator.
- **Every request** with a token loads the operator record; `active = false` or a missing record means 401, regardless of the token's validity. This is the only revocation mechanism and it is enough: to shut someone out, deactivate the record.
- Cookie-authenticated writes require the `X-Requested-With: drafter` header (CSRF). Bearer-authenticated requests are exempt. A present `Authorization` header is decisive; the cookie is consulted only when it is absent.
- The `Actor` trailer on every admin-originated commit is the operator's email.

## CLI sign-in: device code

1. `drafter-axi login you@example.org` calls `POST /auth/device` with the email and receives a `device_code` (secret, kept by the CLI) and a `user_code` (8 characters, shown to the person), and the server emails the operator a magic link whose return path is `/auth/device?code=<user_code>`.
2. The person (or the bot's mailbox owner) follows the link; the web session is created; the approval page shows the `user_code` and an "Approve this device" button. Approving binds the pending device code to the operator.
3. The CLI polls `POST /auth/device/token` with the `device_code` every 3 seconds for up to 15 minutes; once approved it receives the 90-day CLI token and writes it to the profile. Pending device codes live in memory; a restart before approval fails the login and the CLI says so.
4. `drafter-axi logout` deletes the stored token. `drafter-axi whoami` shows the operator and expiry.

## Data-repository refresh (webhook)

Because the service is the data repository's single writer, changes pushed to the remote from elsewhere are not visible until the service refreshes. `POST /admin/api/refresh`, authenticated by an HMAC signature over the body with `DATA_REPO_WEBHOOK_SECRET` (GitHub's `X-Hub-Signature-256`), makes the service: acquire the write lock, confirm the push daemon has no pending commits (otherwise respond 409 `refresh_busy` and let the caller retry), `git fetch`, fast-forward the local branch to the remote (a non-fast-forward is refused with 409 `refresh_diverged` and logged), rebuild the read model, release the lock. There is no periodic fetch. This is how a hand edit made with `gitsheets-axi` and pushed to the remote reaches the running instance.

## Principles

**Inherited**
- [One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby): document lists are scoped to the caller; cross-operator lookups 404.
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): operators and their document memberships are records; every change to them is a commit with an honest `Actor`.

**Local**
- **Authorization comes from the record, never from the token.** A token proves who is asking; whether they may act is read from `operators` and `documents.operators` on every request. Nothing about permissions is cached in a claim.
- **Bots are people-shaped in the record.** An agent has its own operator record and email so that attribution, revocation and document membership work identically for humans and bots.
