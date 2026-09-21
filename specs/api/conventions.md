# API: Conventions

## URL scheme

| Prefix | Audience | Auth |
| --- | --- | --- |
| `/i/:token` | participant pages (SPA shell) | token in path |
| `/i/:token/api/*` | participant API | token in path |
| `/d/:slug/*` | public pages, embeds, JSON | none (enumerated anonymous) |
| `/admin/*` | admin pages (SPA shell) | operator session cookie |
| `/admin/api/*` | admin API | operator token as `Authorization: Bearer` **or** session cookie + CSRF header |
| `/admin/api/refresh` | data-repo refresh webhook | HMAC signature (`DATA_REPO_WEBHOOK_SECRET`) |
| `/auth/*` | magic-link request and callback, device-code flow, session, refresh, logout | none / cookie / bearer (see `api/auth.md`) |
| `/_health` | liveness | none |

The gateway is deny-by-default: every route declares `participant`, `operator`, `webhook`, or `public`; undeclared routes fail closed.

Deny-by-default is about *routes*, not about *addresses a person typed*. A `GET` for a path that matches nothing at all — `/login`, `/sign-in`, a mistyped personal link — is a 404, and when the request accepts HTML it is answered with the app's own "this isn't available" page rather than a JSON error body. A visitor who guessed at a URL is shown a page; only a client that asked for JSON is given JSON. The app's pages are served for the page routes only: a path under one of the API prefixes above (`/i/:token/api/*`, `/d/:slug/api/*`, `/admin/api/*`) that matches no route is a 404 like any other unrouted path, and never the app's shell with a 200 — a mistyped endpoint must come back as an error the caller can read, not as HTML that looks like it worked. Bearer and cookie are never mixed on one request; a present `Authorization` header is decisive. Operator routes that name a document also require the caller to be one of its operators; otherwise 404.

## Content

JSON request and response bodies, `application/json; charset=utf-8`. Rendered document HTML is delivered as a JSON string field, sanitized. Times are ISO 8601 UTC; the client localizes.

## Responses

Success bodies are the resource or a domain-shaped object; no generic envelope. Errors:

```json
{ "error": "phase_closed", "message": "Comments closed Sep 23 at 5:00 PM EDT.", "details": { "phase": "signing", "comments_close_at": "2026-09-23T21:00:00Z" } }
```

| Status | `error` values |
| --- | --- |
| 400 | `invalid_request` (schema), `invalid_anchor`, `judgement_requires_comments`, `attestation_required` |
| 401 | `unauthenticated` (operator routes only; participant tokens never 401), `operator_inactive` |
| 403 | `forbidden`, `csrf_required` |
| 404 | `not_found` (also used for unknown/revoked/expired tokens and non-public documents) |
| 409 | `phase_closed`, `version_stale`, `deadline_not_later`, `stale_edit`, `unsaved_items`, `no_change`, `already_exists`, `last_operator`, `refresh_busy`, `refresh_diverged`, `device_pending` |
| 422 | `validation_failed` with field errors; `no_deadline_set`; a record the store rejects (schema `ValidationError`) is reported the same way, with `details.issues` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` |

**A request the server rejects before a handler runs is still the caller's mistake.** A body that fails to parse, a body over the size limit, a content type nothing accepts: each already carries a 4xx status by the time the error envelope is built, and that status is kept, with the `error` value this table gives for it (any other 4xx reads as `invalid_request`), a message naming the problem, and the framework's own error code in `details.code` so a caller can look it up. `internal_error` means a 5xx and nothing else — reporting a malformed request as a server fault sends the caller looking for the fault in the wrong place.

Every response carries `X-Request-Id`; the id is also written as a commit trailer on any write it caused.

## Idempotency

Write endpoints that a client may retry (`sign`, `submit`, draft `PUT`) accept an `Idempotency-Key` header; a repeated key within 24 hours returns the original result.

## Versions in the API

Participant and public endpoints accept `?v=<n>` where a version is optional; default is current. A write that depends on a version (submit, sign) carries `version` in the body; the server rejects with `version_stale` only where the spec requires (submit against a version older than the draft's declared version).

## Rate limits

Token-resolution failures: 30 per minute per source address. Participant writes: 60 per minute per token. Admin bearer: none.

`GET /d/:slug/statement.pdf`: 10 per minute per source address. It is the only anonymous route whose cost is a headless browser rather than a map lookup, and a cached render does not help a caller walking the paper sizes or a document that has just taken a signature. Over budget is 429 `rate_limited`; every other public route stays unlimited.

## Principles

**Inherited**

- [The clock is real](../principles.md#the-clock-is-real): `phase_closed` is computed from the document's timestamps on every write; there is no admin override flag on the request.
