---
status: done
pr: TBD
depends: []
specs:
  - specs/api/auth.md
---

# Plan: configurable-login-rate-limit

## Scope
Make the sign-in rate limit (5 per address and per source IP per 15 minutes) configurable through `AUTH_LOGIN_RATE_LIMIT`, defaulting to the spec's 5, so a simulated campaign run that signs many operators in from one machine is not blocked by the per-IP limit. Out: any change to the default or to how the limiter works.

## Implements
- `specs/api/auth.md` — § POST /auth/login rate limits ("by default", the env var).

## Approach
1. `@fastify/env` schema gains `AUTH_LOGIN_RATE_LIMIT` (integer, default 5, minimum 1); the auth plugin constructs both limiters from it.
2. OpenTofu variable `auth_login_rate_limit` (default 5) wired to the Cloud Run env; `terraform.tfvars` sets 500 for the run and is returned to 5 afterwards.

## Validation
- [x] Default behavior unchanged: existing auth tests (rate-limit cases) pass without configuration.
- [x] `tofu validate` passes with the new variable.

## Risks / unknowns
- Forgetting to lower the value after the run: the tfvars comment names the date and the reason.

## Notes
- Motivated by the 2026-09-20 simulated campaign run; the shared-IP wall is also a real-world finding (shared office networks) worth a later look at keying the limit differently.

## Follow-ups
- Return `auth_login_rate_limit` to 5 after the run.
