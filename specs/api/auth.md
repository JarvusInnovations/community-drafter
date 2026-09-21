# API: Auth

Operator sign-in and sessions. All under `/auth`, `public` capability unless stated. Behavior is defined in `behaviors/operators.md`; scoping by site in `behaviors/sites.md`.

**Every route here is per host.** The site is resolved from the host the request was addressed to; sign-in matches the address within *that* site's operator group, every link the flow emails is built on that host, and the session it creates belongs to it. Auth routes never redirect between hosts.

## `POST /auth/login`

Body `{ email, return? }`. Always 202 `{ ok: true }` regardless of whether the email is an operator **of this site** — an operator of another site gets the same response and no mail. When it is an active operator of the resolved site, emails a magic link to `https://<the resolved site's hostname>/auth/callback?code=<code>` whose return path is `return` (validated) or `/admin`. The **code** is 24 random base62 characters that maps, in memory and for 15 minutes, to the signed magic token; the token itself never appears in a URL or an email, so the link stays short and does not look like a credential payload. Rate limits: 5 per address and 5 per source IP per 15 minutes by default (`AUTH_LOGIN_RATE_LIMIT` sets the per-window count, for test environments that sign many operators in from one machine) → 429 `rate_limited`.

## `GET /auth/callback?code=`

Resolves the code to its magic token (unknown or expired code → failure page), verifies the token (signature, `purpose: magic`, expiry 15 min, unused `jti`, operator still active), deletes the code and marks the `jti` used, sets the session cookie, redirects 302 to the return path. Invalid, expired, used or inactive → an HTML page "This sign-in link isn't valid any more" with a link to `/admin/login`.

## `GET /auth/session`

Cookie or bearer. Returns `{ email, name, kind, superadmin, expires_at, transport, site }` or 401 `unauthenticated` / `operator_inactive`.

`site` is the resolved site (`behaviors/sites.md`): `{ slug, name, hostname, logo_url, accent }`, which on a deployment with no sites is the default site — `name` being `INSTANCE_NAME`, falling back to `Community Drafter`. It rides on the session because the admin frame needs it on every page and already resolves the session there (`screens/admin-dashboard.md` § Design "Frame"); a separate endpoint would be a second round trip for one object. It replaces the earlier `instance_name` string, is not a secret, and is not operator-specific.

## `POST /auth/logout`

Cookie + CSRF header. Clears the cookie. (Bearer tokens are forgotten by the client; deactivating the operator revokes them.)

## `POST /auth/refresh`

Bearer only. Returns a new 90-day CLI token for the same operator if the presented token is valid and the operator is active; 401 otherwise. Web sessions do not refresh; they expire at 24 hours.

## Device-code flow

- `POST /auth/device` `{ email }` → 202 `{ device_code, user_code, expires_in: 900, interval: 3 }`, and emails the operator a magic link whose return path is `/auth/device?code=<user_code>`. Same rate limits and the same non-disclosing behavior as `login`; a non-operator email still receives a `device_code` that will simply never be approved.
- `GET /auth/device?code=` (SPA page) → shows the code and the approve button for the signed-in operator.
- `POST /auth/device/approve` `{ user_code }` (cookie + CSRF) → binds the pending code to the session's operator; 404 for unknown/expired codes.
- `POST /auth/device/token` `{ device_code }` → 200 `{ token, expires_at, email }` once approved; 409 `device_pending` while waiting; 404 when expired or unknown. Clients poll at `interval`.

Pending device codes, magic-link codes and used magic-link `jti`s are in memory; a restart drops them (the CLI reports "sign-in expired, run login again").

## Token shape

JWT, HS256 with `AUTH_SECRET`. Claims: `sub` (operator email, lowercase), `kind`, `name`, `purpose` (`session` | `cli` | `magic`), `site` (the slug of the site it was minted on), `sid` or `jti`, `iat`, `exp`. A token whose `site` is not the request's resolved site is 401 `unauthenticated`, exactly as no credential at all; the session cookie is host-only anyway, and the claim is what gives a bearer token the same property. `purpose` is enforced per endpoint (a magic token never authenticates a request; a session token never approves a device from the bearer transport). Tokens carry no permissions. Magic tokens are internal: the emailed link carries only the short code.

## Principles

**Inherited**
- [The link is the identity](../principles.md#the-link-is-the-identity) applies to participants only; operators are the one place the system asks a person to prove an email, because they act on others' behalf.

**Local**
- **A credential belongs to one hostname.** A session or CLI token is good on the host that minted it and nowhere else, so an operator on two sites holds two of them and nothing about site scoping depends on a handler remembering to check.
- **No token outlives its record.** Every authenticated request re-reads the operator; a deactivated record turns every outstanding token into a 401 immediately.
