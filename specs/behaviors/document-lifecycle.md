# Behavior: Document Lifecycle and the Clock

## Rule

A document moves through a fixed sequence of phases governed by timestamps the participant can see. What a participant may do is a pure function of the current phase.

```
draft ──open──► commenting ──clock──► signing ──clock──► closed
                    │                    │
                    └── withdrawn ◄──────┘   (admin, any time)
```

`state` on the document record is `draft`, `open`, `closed` or `withdrawn`. Within `open`, the phase is derived at read time:

| Condition | Phase |
| --- | --- |
| `now < comments_close_at` | **commenting** |
| `comments_close_at ≤ now < signing_closes_at` | **signing** |
| `now ≥ signing_closes_at` | **closed** (state is also flipped to `closed` by the first read or the scheduler that observes it) |

## Applies To

Every participant screen, the participant API, the admin dashboard, notifications.

## What each phase allows

| Action | draft | commenting | signing | closed | withdrawn |
| --- | --- | --- | --- | --- | --- |
| Open personal link, read current version | admin only | ✓ | ✓ | ✓ | "withdrawn" notice |
| View history and diffs | admin only | ✓ | ✓ | ✓ | ✗ |
| Sign | ✗ | ✓ | ✓ | ✗ | ✗ |
| Revoke signature | ✗ | ✓ | ✓ | ✗ | ✗ |
| Save draft comments | ✗ | ✓ | ✗ (existing drafts remain readable to their author) | ✗ | ✗ |
| Submit review with comments | ✗ | ✓ | ✗ | ✗ | ✗ |
| Submit `decline` (no comments) | ✗ | ✓ | ✓ | ✗ | ✗ |
| Change notification preferences | ✗ | ✓ | ✓ | ✓ | ✓ |
| Admin: publish version | ✓ | ✓ | ✓ (extends the window, see below) | ✗ unless reopened | ✗ |
| Admin: create/send invitations | ✓ (send waits for open) | ✓ | ✓ | ✗ | ✗ |

An action attempted outside its allowed phase fails with a clear message naming the phase and the deadline that closed it. The server enforces this; the UI merely reflects it.

## Details

**Opening.** Admin sets `comments_close_at` and `signing_closes_at` (both required, `comments_close_at < signing_closes_at`) and at least one version must exist. Opening records `opened_at`, sets `state = open`, and queues invitation messages for every participation without `sent_at`.

**The visible clock.** Every participant page shows the current phase and the next deadline as both an absolute time (participant's local time zone, with zone name) and a relative countdown ("closes in 2 days 4 hours"). Within the last 24 hours the countdown updates live. The planned later deadline is also shown ("signatures and removals until Sep 30").

**Comments close on the clock.** At `comments_close_at`, comment submission stops. A participant mid-draft sees their draft preserved and a notice that comments closed at the deadline. The team is expected to publish the final version shortly after; nothing in the system waits for it.

**Publishing during signing extends the window.** When a version is published while the phase is signing, `signing_closes_at` becomes `max(signing_closes_at, now + revocation_window_hours)`. Signers are notified that a new version is published and the exact time until which they may remove their name. This is the mechanism behind "just sign it for now".

**Extension.** Admin may move either deadline later at any time before it passes, and may move `signing_closes_at` later after `comments_close_at` has passed. Deadlines are never moved earlier once the document is open. Every change is recorded (commit) and announced to subscribers of phase changes with old and new times.

**Closing.** At `signing_closes_at` the document becomes `closed`: the signatory list freezes, the current version is the final text, and the participant page becomes a read-only record showing the final version, the signatory list and the full version history. A `closed` notification goes to signers and commenters per preferences.

**Reopening.** Admin may reopen a closed document by setting a new `signing_closes_at` in the future (re-entering signing) or both deadlines (re-entering commenting). Reopening is recorded and announced; it is expected to be rare.

**Withdrawing.** Admin sets `state = withdrawn` with a reason. Personal and public links show a short notice that the document was withdrawn, with the reason if the admin marked it public. No further actions are possible. Records are retained.

**Draft state.** A `draft` document is reachable only by admin credentials. Invitations may be created (so links can be prepared) but the links resolve to a "not yet open" page until opening.

## Principles

**Inherited**
- [The clock is real](../principles.md#the-clock-is-real): phase is computed from timestamps at request time; no admin action is needed for a deadline to bite, and extensions are recorded and announced.
- [Just sign it for now](../principles.md#just-sign-it-for-now): signing is allowed from the first moment of the comment period, and a publish during signing guarantees a fresh revocation window.

**Local**
- **Deadlines only move later.** An earlier deadline would retroactively invalidate the promise made on every page and email that quoted the old one.
