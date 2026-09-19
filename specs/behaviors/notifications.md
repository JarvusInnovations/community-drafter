# Behavior: Notifications

## Rule

The system sends a small set of **transactional** messages unconditionally and a larger set of **subscription** messages according to each participation's preferences, with role-based defaults. Every message is rendered from a template, carries the recipient's personal link, is recorded on success under `participations.notified.<event>` so it can never be sent twice, and (for subscription messages) includes a one-click preference link.

## Applies To

Sending on publish, phase transitions, submissions and signature changes; the daily digest job; admin-triggered reminders; `screens/preferences.md`.

## Channels

- **email** (phase 1): via the configured `Mailer`. From: `documents.sender_name <INSTANCE_FROM_EMAIL>`, Reply-To `documents.reply_to`.
- **export**: when the mailer is `export`, "sending" writes rows to a CSV the admin can mail-merge and marks `notified` as if sent.
- **sms** **[phase 2]**: via Twilio; only for `invitation`, `signing-opened`, `closing-soon` and `closed` events; requires `people.phone`. Preferences carry `channel` so the field exists in phase 1.

## Messages

| Event key | Trigger | Recipients | Transactional? |
| --- | --- | --- | --- |
| `invitation` | document opened, or admin "send" for later-added invitations | invitations without `sent_at` | yes |
| `signature-confirmation-<ts>` | a signature written | the signer | yes |
| `revocation-confirmation-<ts>` | a revocation written | the signer | yes |
| `review-receipt-<ts>` | a review submitted | the author | yes (brief; lists judgement and comment count) |
| `v<n>` | a version published | invitees with `every_revision` | subscription |
| `digest-<date>` | daily job, only if anything changed that day | invitees with `daily_digest` | subscription |
| `signing-opened` | phase becomes signing (the clock) | all invitees with `phase_changes` who have opened the link, plus every current signer regardless | subscription (signers: forced on) |
| `final-published` | a version with `final = true` published | every current signer, every commenter with `phase_changes`; conditional signers get the confirm/remove variant | subscription (signers: forced on) |
| `closing-soon` | 24 hours before `signing_closes_at` | current signers | subscription (forced on) |
| `closed` | phase becomes closed | signers and commenters with `phase_changes` | subscription |
| `schedule-changed` | admin extends or reopens | invitees with `phase_changes` | subscription |
| `disposition-v<n>` | a version published with dispositions on the recipient's comments | those authors with `my_comments_addressed` | subscription |
| `reminder-<n>` | admin action "remind", targeted at unopened or opened-but-not-acted invitations | targets with `reminders` | subscription |

"Forced on" means the preference toggle is shown disabled with the explanation that signers are always told when the final text lands and when the window closes.

## Defaults

Set when the participation is created, editable by the participant at any time:

| Preference | Default |
| --- | --- |
| `channel` | `email` |
| `every_revision` | off |
| `daily_digest` | off |
| `phase_changes` | on |
| `my_comments_addressed` | on |
| `reminders` | on (until the person signs, comments, or declines; then automatically off) |

## Content rules

- Every message names the document, states the current phase and its next deadline in the recipient's time zone when known (else the document's), and links to the personal link.
- Revision messages include the version number, the summary line, and a "see what changed" link to the diff.
- The digest lists versions published, disposition outcomes for the recipient's comments, and current signatory counts, for the previous 24 hours.
- Subscription messages end with "Manage how we contact you" → `/i/<token>/prefs` and a one-click "stop all optional messages" link that sets every optional preference off (transactional messages continue).
- No message ever includes another participant's contact details or unsubmitted content.
- Subject lines are short and stable: "[Title] — version 3 published", "[Title] — final version, please confirm", "[Title] — you signed".

## Sending

- Sends are derived, not stored: the commit that causes them (a publish, a phase change, an admin `send`/`remind`) is the trigger; the dispatcher computes recipients from preferences and `notified`, and dispatches with retries (3 attempts, exponential backoff). Failures after the last attempt are logged and shown in the dashboard from memory.
- Idempotency: the event key is checked against `participations.notified` before dispatch; present means skip. Because recipients are derived from record state, a restart re-derives outstanding sends and the `notified` check keeps them from repeating.
- Preference-suppressed sends are simply not sent; coverage is computed from preferences on demand.
- After a batch (invitation blast, revision alerts) the successes are recorded in **one commit** (`Action: send`, `Comments`-style list of persons in the body) patching each recipient's `notified`, never one commit per recipient.
- The digest job runs once daily at a configured hour in the instance time zone.

## Principles

**Inherited**
- [Essentials always, everything else opt-in](../principles.md#essentials-always-everything-else-opt-in).
- [Just sign it for now](../principles.md#just-sign-it-for-now): `final-published` and `closing-soon` are forced on for signers because the early-sign promise depends on them.

**Local**
- **A person hears about a version at most once per channel.** If someone has both `every_revision` and `daily_digest` on, the digest omits versions already sent as `v<n>`.
