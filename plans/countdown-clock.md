---
status: done
pr: 123
depends: []
issues: []
specs:
  - specs/screens/document.md
---

# Plan: countdown-clock

## Scope

The Timeline's countdown chips read the real clock through `useCountdown`, even when the
Timeline is given a fixed `now`. A test fixed at 2026-09-20 with a comments deadline of
2026-09-24 started failing once the real date passed that deadline. Behavior is unchanged
for participants; the fix makes the component's clock injectable end to end.

## Approach

`useCountdown(deadline, now?)`: when `now` is given, return the countdown for that moment
and schedule no timers; otherwise behave as today. `Timeline` passes its `now` prop through.

## Validation

- [x] `Timeline.test.tsx` passes regardless of the real date.
- [x] Web gates green (lint, typecheck, 121/121 tests).

## Notes

Found while reviewing PR #121, whose web suite failed only on this test; it had been failing on develop since the real clock passed the fixture deadline (2026-09-24).
