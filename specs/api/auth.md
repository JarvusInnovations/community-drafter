# API: Auth

Operator sign-in and sessions. All under `/auth`, `public` capability unless stated. Behavior is defined in `behaviors/operators.md`.

## `POST /auth/login`

Body `{ email, return? }`. Always 202 `{ ok: true }` regardless of whether the email is an operator. When it is an active operator, emails a magic link to `<PUBLIC_URL>/auth/callback?code=<code>` whose return path is `return` (validated) or `/admin`. The **code** is 24 random base62 characters that maps, in memory and for 15 minutes, to the signed magic token; the token itself never appears in a URL or an email, so the link stays short and does not look like a credential payload. Rate limits: 5 per address and 5 per source IP per 15 minutes → 429 `rate_limited`.

## `GET /auth/callback?code=`

Resolves the code to its magic token (unknown or expired code → failure page), verifies the token (signature, `purpose: magic`, expiry 15 min, unused `jti`, operator still active), deletes the code and marks the `jti` used, sets the session cookie, redirects 302 to the return path. Invalid, expired, used or inactive → an HTML page "This sign-in link isn't valid any more" with a link to `/admin/login`.

## `GET /auth/session`

Cookie or bearer. Returns `{ email, name, kind, expires_at, transport }` or 401 `unauthenticated` / `operator_inactive`.

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

JWT, HS256 with `AUTH_SECRET`. Claims: `sub` (operator email, lowercase), `kind`, `name`, `purpose` (`session` | `cli` | `magic`), `sid` or `jti`, `iat`, `exp`. `purpose` is enforced per endpoint (a magic token never authenticates a request; a session token never approves a device from the bearer transport). Tokens carry no permissions. Magic tokens are internal: the emailed link carries only the short code.

## Principles

**Inherited**
- [The link is the identity](../principles.md#the-link-is-the-identity) applies to participants only; operators are the one place the system asks a person to prove an email, because they act on others' behalf.

**Local**
- **No token outlives its record.** Every authenticated request re-reads the operator; a deactivated record turns every outstanding token into a 401 immediately.
