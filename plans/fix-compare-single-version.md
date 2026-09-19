---
status: done
depends: [participant-sign-flow, public-and-embed]
specs:
  - specs/screens/document.md
  - specs/screens/version-history.md
---

# Plan: fix-compare-single-version

## Scope
Bug fix found on the live prototype: on a document with one version, "See what changed" linked to a compare of v1 against itself and the compare page showed "Something went wrong". Out: any change to the compare API.

## Implements
- `specs/screens/document.md` — the version label offers "See what changed" only when an earlier version exists.
- `specs/screens/version-history.md` — the compare page explains a same-version comparison instead of erroring.

## Approach
Hide the link on v1 in both the participant and public version labels; short-circuit both compare screens when `from === to` with a plain message.

## Validation
- [x] Version label on v1 shows no "See what changed" link (participant and public).
- [x] `/history/compare?to=1` renders the nothing-to-compare message, no request, no error.
- [x] Lint, format, typecheck, tests and bundle-size check pass.

## Risks / unknowns
None.

## Notes
Found by the operator on a phone within minutes of the first deploy; the spec had listed the link unconditionally.

## Follow-ups
None.
