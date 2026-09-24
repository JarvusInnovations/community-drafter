# API: Auth

Operator sign-in and sessions. All under `/auth`, `public` capability unless stated. Behavior is defined in `behaviors/operators.md`; scoping by site in `behaviors/sites.md`.

**Every route here is per host.** The site is resolved from the host the request was addressed to; sign-in matches the address within *that* site's operator group, every link the flow emails is built on that host, and the session it creates belongs to it. Auth routes never redirect between hosts.

## `POST /auth/login`

Body `{ email, return? }`. Always 202 `{ ok: true }` regardless of whether the email is an operator **of this site** — an operator of another site gets the same response and no mail. When it is an active operator of the resolved site, emails a magic link to `https://<the resolved site's hostname>/auth/callback?op=<operator id>&code=<code>`, plus `&return=<path>` when the return path is `return` (validated) rather than the default `/admin`. The **code** is 24 base62 characters: 6 encode the link's expiry (15 minutes after it was sent) and 18 are an HMAC-SHA256 with `AUTH_SECRET` over the resolved site, the operator's id and email, the expiry and the return path. The link carries its own proof, so **no server state is needed to honor it**, and a link followed after the instance that sent it has been stopped still works (`architecture.md` § Deployment). It stays short and does not look like a credential payload. Rate limits: 5 per address and 5 per source IP per 15 minutes by default (`AUTH_LOGIN_RATE_LIMIT` sets the per-window count, for test environments that sign many operators in from one machine) → 429 `rate_limited`.

## `GET /auth/callback?op=&code=&return=`

Looks up the operator by `op`, recomputes the HMAC for the request's resolved site, that operator's current email, the code's expiry and `return` (absent means `/admin`), and compares it in constant time. It then checks that the expiry has not passed, that this code has not been used, and that the operator is still active. It marks the code used, sets the session cookie and redirects 302 to the return path. A link is good only on the host that sent it, because the site is inside the MAC. Used codes are remembered in memory until they expire, so a replay after a restart within the 15 minutes is accepted as a known limitation; replaying needs the link, and the link is the credential. Invalid, expired, used or inactive → an HTML page "This sign-in link isn't valid any more" with a link to `/admin/login`.

## `GET /auth/session`

Cookie or bearer. Returns `{ email, name, kind, superadmin, expires_at, transport, site }` or 401 `unauthenticated` / `operator_inactive`.

`site` is the resolved site (`behaviors/sites.md`): `{ slug, name, hostname, logo_url, accent }`, which on a deployment with no sites is the default site — `name` being `INSTANCE_NAME`, falling back to `Signatories`. It rides on the session because the admin frame needs it on every page and already resolves the session there (`screens/admin-dashboard.md` § Design "Frame"); a separate endpoint would be a second round trip for one object. It replaces the earlier `instance_name` string, is not a secret, and is not operator-specific.

## `POST /auth/logout`

Cookie + CSRF header. Clears the cookie. (Bearer tokens are forgotten by the client; deactivating the operator revokes them.)

## `POST /auth/refresh`

Bearer only. Returns a new 90-day CLI token for the same operator if the presented token is valid and the operator is active; 401 otherwise. Web sessions do not refresh; they expire at 24 hours.

## Device-code flow

- `POST /auth/device` `{ email }` → 202 `{ device_code, user_code, expires_in: 900, interval: 3 }`, and emails the operator a magic link whose return path is `/auth/device?code=<user_code>`. Same rate limits and the same non-disclosing behavior as `login`; a non-operator email still receives a `device_code` that will simply never be approved.
- `GET /auth/device?code=` (SPA page) → shows the code and the approve button for the signed-in operator.
- `POST /auth/device/approve` `{ user_code }` (cookie + CSRF) → binds the pending code to the session's operator; 404 for unknown/expired codes.
- `POST /auth/device/token` `{ device_code }` → 200 `{ token, expires_at, email }` once approved; 409 `device_pending` while waiting; 404 when expired or unknown. Clients poll at `interval`.

Pending device codes are in memory. The flow keeps the instance alive while one is pending, because the CLI polls every 3 seconds and an instance that is receiving requests is not idle, so the approval arrives at the instance that holds the code. A restart mid-flow (a deploy) drops the code, and the CLI reports "sign-in expired, run login again".

## Token shape

JWT, HS256 with `AUTH_SECRET`. Claims: `sub` (operator email, lowercase), `kind`, `name`, `purpose` (`session` | `cli`), `site` (the slug of the site it was minted on), `sid`, `iat`, `exp`. A token whose `site` is not the request's resolved site is 401 `unauthenticated`, exactly as no credential at all; a token minted before the claim existed carries none and reads as `default`, which is where it was minted; the session cookie is host-only anyway, and the claim is what gives a bearer token the same property. `purpose` is enforced per endpoint (a session token never approves a device from the bearer transport). Tokens carry no permissions. A magic link is not a token of this shape: it is the signed code described under `POST /auth/login`, and nothing but the callback accepts it.

## Principles

**Inherited**

- [The link is the identity](../principles.md#the-link-is-the-identity) applies to participants only; operators are the one place the system asks a person to prove an email, because they act on others' behalf.

**Local**

- **A credential belongs to one hostname.** A session or CLI token is good on the host that minted it and nowhere else, so an operator on two sites holds two of them and nothing about site scoping depends on a handler remembering to check.
- **No token outlives its record.** Every authenticated request re-reads the operator; a deactivated record turns every outstanding token into a 401 immediately.
