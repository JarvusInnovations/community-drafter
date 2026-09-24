---
status: in-progress
depends: []
specs:
  - specs/architecture.md
  - specs/api/auth.md
  - specs/api/conventions.md
  - specs/behaviors/operators.md
  - specs/behaviors/notifications.md
  - specs/behaviors/document-lifecycle.md
---

# Plan: scale-to-zero

## Scope

Let the Cloud Run service scale to zero when idle (owner decision, 2026-09-24) without losing a write or a scheduled job. `max_instance_count` stays 1, because the service is the data repo's single writer. In: pushing before acknowledging a write, a shutdown sequence that fits in Cloud Run's 10 seconds, a scheduler tick replacing in-process timers, stateless magic links, cold-start tuning, and the `tf/` for all of it. Out: moving any state off git; changing the device-code flow's storage (the CLI's polling keeps the instance alive while a code is pending).

## Implements

- `specs/architecture.md`: § Storage (pushed before acknowledged; the flush cadence), § API server (the `scheduler` capability; no scheduled work on timers), § Authentication departure (nothing a person needs across an idle period lives only in memory), § Deployment (scale to zero, shutdown, cold start, the scheduler, the webhook).
- `specs/api/auth.md`: stateless magic-link codes; the token shape without `magic`; device codes kept alive by polling.
- `specs/api/conventions.md`: `/internal/tick` and the `scheduler` capability.
- `specs/behaviors/operators.md`: the magic link and device code across idle periods; `refresh_busy` in terms of pending pushes.
- `specs/behaviors/notifications.md` § Sending: the digest runs from the tick.
- `specs/behaviors/document-lifecycle.md`: the closed flip comes from the tick (the spec's "first read" flip never existed in code).

## Approach

1. **Pusher** (`storage/pusher.ts`) replaces the gitsheets push daemon. It serializes `git push origin <branch>` with a per-attempt timeout, counts commits pending since the last successful push, and never retries a non-fast-forward. `storage.commit()` awaits a push for up to 10 s after each commit, and a failure there never fails the request. At startup it pushes any commits already ahead of `origin`. Why not keep the daemon: its `stop()` only waits for a push already in flight and pushes nothing that is pending, and a commit that arrives during an in-flight push is dropped at stop (the stop resolver fires without chaining another drain). So it cannot be the shutdown flush. `/_health` reports `storage.push`, and `refresh` checks its pending count.
2. **Shutdown** (`index.ts`): on SIGTERM, `server.close()` (503 for new requests, in-flight ones finish), then the storage `onClose` flushes the tracker and does a final synchronous push. A hard 9 s deadline exits regardless and logs any unpushed count. `pluginTimeout` goes up to 60 s so a slow boot clone does not crash a cold start.
3. **Tick** (`tick/`): a `scheduler` capability in the gateway verifies a Google OIDC ID token (via `jose`, Google's JWKS, issuer, `TICK_AUDIENCE`, `TICK_INVOKER_EMAIL` with `email_verified`). `POST /internal/tick` runs, serialized, the tracker flush, the push retry, `phaseObserver.tick()` and the digest. The digest and phase-observer `setInterval`s are removed, and so are their test-only options.
4. **Magic links**: HMAC code (6-char base62 expiry + 18-char base62 MAC over site, operator id, email, expiry and return path), `?op=&code=[&return=]`. No `MagicCodeStore`, no magic JWT. Used codes are held in memory until expiry.
5. **tf**: `min_instance_count = 0`, `cpu_idle = true`, `startup_cpu_boost = true`, startup probe every 2 s up to 2 min, env `TICK_AUDIENCE`/`TICK_INVOKER_EMAIL`, `cloudscheduler.googleapis.com`, a `signatories-tick` service account with `roles/run.invoker`, a `google_cloud_scheduler_job` every 15 min with an OIDC token, the CI deploy account's `cloudscheduler.admin` and actAs on the invoker, and the plan gate's `cloudscheduler.viewer`.
6. `docs/operations.md`: health fields, the deploy order, what a cold start looks like, the tick.

## Validation

- [ ] Graceful shutdown against a fake (bare, local) remote: a pending open count and an unpushed commit are both on the remote after `server.close()`, and the sequence finishes inside the deadline.
- [ ] A write request's commit is on the remote when the response arrives. With the remote broken, the request still succeeds and `storage.push.pendingCommits > 0`.
- [ ] `POST /internal/tick` with no token, a garbage token, a token signed by the wrong key, or one with the wrong audience or email → 401. With a valid token → 200, and the digest is sent once (a second tick in the same hour sends nothing).
- [ ] A magic link works on a fresh server instance built over the same data repo and secret (a simulated restart), and is refused on another site's host, after expiry, on a second use, and after tampering with `return`.
- [ ] No `setInterval` is left in the api for scheduled work other than the tracker's warm flush and the renderer's idle timer.
- [ ] api gates: lint, format:check, typecheck, tests.
- [ ] `tofu fmt -check`, `tofu validate` and `tofu plan -concise` show only the intended changes.
- [ ] Push time and cold start measured and recorded in the PR.

## Risks / unknowns

- **CPU at shutdown under request-based billing.** Cloud Run allocates CPU during the SIGTERM grace period even with `cpu_idle = true`. Confirm after deploy that the `shutdown: pushed` log line appears when an instance idles out.
- **Two revisions during a deploy.** A rollout briefly runs the old and the new revision side by side, as it did before this change. The old revision's shutdown runs the *old* code, so the image carrying this plan must be deployed before (or in the same apply as) `min_instance_count = 0`.
- **Ticks keep the instance warm.** A tick every 15 minutes means an instance may rarely reach zero for long; under request-based billing an idle instance is not billed for CPU, so this costs little.
- Issue #108 (a session reported ending after about 14 minutes): sessions are stateless 24-hour JWTs signed with a stable `AUTH_SECRET`, and nothing in the session path reads process memory, so a restart cannot end one. The in-memory magic-link code store could have made a *link* fail after a restart, but not a session. Not fixed here; the issue stays open for a live repro.

## Notes

## Follow-ups
