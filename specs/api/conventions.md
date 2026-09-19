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

The gateway is deny-by-default: every route declares `participant`, `operator`, `webhook`, or `public`; undeclared routes fail closed. Bearer and cookie are never mixed on one request; a present `Authorization` header is decisive. Operator routes that name a document also require the caller to be one of its operators; otherwise 404.

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
| 409 | `phase_closed`, `version_stale`, `deadline_not_later`, `stale_edit`, `unsaved_items`, `no_change`, `last_operator`, `refresh_busy`, `refresh_diverged`, `device_pending` |
| 422 | `validation_failed` with field errors |
| 429 | `rate_limited` |

Every response carries `X-Request-Id`; the id is also written as a commit trailer on any write it caused.

## Idempotency

Write endpoints that a client may retry (`sign`, `submit`, draft `PUT`) accept an `Idempotency-Key` header; a repeated key within 24 hours returns the original result.

## Versions in the API

Participant and public endpoints accept `?v=<n>` where a version is optional; default is current. A write that depends on a version (submit, sign) carries `version` in the body; the server rejects with `version_stale` only where the spec requires (submit against a version older than the draft's declared version).

## Rate limits

Token-resolution failures: 30 per minute per source address. Participant writes: 60 per minute per token. Admin bearer: none.

## Principles

**Inherited**
- [The clock is real](../principles.md#the-clock-is-real): `phase_closed` is computed from the document's timestamps on every write; there is no admin override flag on the request.
