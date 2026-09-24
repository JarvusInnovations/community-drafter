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
| `now ≥ signing_closes_at` | **closed** (state is also flipped to `closed` by the scheduler tick that observes it — `architecture.md` § Deployment; nothing waits on the flip, because every read derives the phase from the clock) |

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
| Admin: confirm-call | ✗ | ✓ | ✓ | ✗ | ✗ |
| Admin: record delivery | ✗ | ✗ | ✓ | ✓ | ✗ |

An action attempted outside its allowed phase fails with a clear message naming the phase and the deadline that closed it. The server enforces this; the UI merely reflects it.

## Details

**Opening.** Admin sets `comments_close_at` and `signing_closes_at` (both required, `comments_close_at < signing_closes_at`) and at least one version must exist. Opening records `opened_at`, sets `state = open`, and queues invitation messages for every participation without `sent_at`.

**The visible clock.** Every participant and public document page shows both deadlines at once as a **timeline** (`screens/document.md` § Header): where the document is between opening, comments closing and signatures being due, with a relative countdown to each deadline ("in 4 days 21 hours") and its absolute time in the reader's zone with the zone name. Countdowns refresh at least every minute and every second within the last 24 hours. A passed deadline is shown as such, never as a negative countdown. Secondary surfaces (comment mode's top bar, emails) may use the one-line form: "Comment period · closes Tue Sep 23, 5:00 PM EDT · in 2 days 4 hours".

**Comments close on the clock.** At `comments_close_at`, comment submission stops. A participant mid-draft sees their draft preserved and a notice that comments closed at the deadline. Nothing is sent: the signing window opening is a state change, not news (`principles.md` § Operators speak; state changes don't). The team may keep publishing versions until delivery; there is no "final" version, and nothing in the system waits for one.

**Publishing during signing extends the window.** When a version is published while the phase is signing, `signing_closes_at` becomes `max(signing_closes_at, now + revocation_window_hours)`. Every page shows the new deadline; nobody is mailed about the publish itself. The signers whose signature is now behind are asked to keep or remove their name by the team's confirm-call before delivery (`behaviors/signatures.md` § Conditional signatures). This is the mechanism behind "just sign it for now".

**Extension.** Admin may move either deadline later at any time before it passes, and may move `signing_closes_at` later after `comments_close_at` has passed. Deadlines are never moved earlier once the document is open. Every change is recorded (commit) and shown on every page at once. It is announced only when the operator asks (`docs extend … --notify`), and then only to the people who opened the document and have not yet signed or declined (`notifications.md` → `schedule-changed-<ts>`); without the flag the command sends nothing and says how many people it would have told.

**Closing.** At `signing_closes_at` the document becomes `closed`: the signatory list freezes, the current version is the text of record, and the participant page becomes a read-only record showing that version, the signatory list and the full version history. Closing sends nothing to participants; the operators' digest reports it. The deliverable goes clean (`screens/deliverable.md` § Draft and clean).

**Delivery.** Any time after signing opens, an operator may record that the statement was delivered (`behaviors/signatures.md` § Delivery). Delivery is a fact about the document, not a phase: it does not close signing, and a document may be delivered while signing is still open.

**Reopening.** Admin may reopen a closed document by setting a new `signing_closes_at` in the future (re-entering signing) or both deadlines (re-entering commenting). Reopening is recorded, and announced only with `--notify`, on the same terms as an extension; it is expected to be rare.

**Withdrawing.** Admin sets `state = withdrawn` with a reason. Personal and public links show a short notice that the document was withdrawn, with the reason if the admin marked it public. No further actions are possible. Records are retained.

**Draft state.** A `draft` document is reachable only by admin credentials. Invitations may be created (so links can be prepared) but the links resolve to a "not yet open" page until opening.

## Principles

**Inherited**
- [The clock is real](../principles.md#the-clock-is-real): phase is computed from timestamps at request time; no admin action is needed for a deadline to bite, and extensions are recorded and shown everywhere.
- [Operators speak; state changes don't](../principles.md#operators-speak-state-changes-dont): no phase transition, extension or publish mails anyone by itself.
- [Just sign it for now](../principles.md#just-sign-it-for-now): signing is allowed from the first moment of the comment period, a publish during signing guarantees a fresh revocation window, and a signer whose text moved is asked once before delivery.

**Local**
- **Deadlines only move later.** An earlier deadline would retroactively invalidate the promise made on every page and email that quoted the old one.
