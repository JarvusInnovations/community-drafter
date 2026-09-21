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
| `listing-changed-<ts>` | a signature's display fields edited — name, descriptor, organization, title or the listing choice (`behaviors/signatures.md` § Changing how a signature is listed) | the signer | yes (names how they are now listed, and says plainly if they are no longer named on the list) |
| `review-receipt-<ts>` | a review submitted | the author | yes (brief; lists judgement and comment count) |
| `operator-magic-link` | an operator requests sign-in (web or device code) | that operator | yes (not a participation message: no `notified` mark, no preference link; subject "Sign in to *Instance name*"; body: greeting by name, one sentence naming the instance URL and what triggered it ("you asked to sign in on the web" or "a command line asked to sign in with code XXXX-YYYY"), a button labeled "Sign in to *Instance name*" with the short-code link, the plain-text alternative with the same URL, "This link works once and expires in 15 minutes", and "If you didn't request this, you can ignore this email." Nothing else: no token, no other links) |
| `operator-added` | an operator record is created (`behaviors/operators.md` § Operators) | that operator | yes (operator message, see § Operator mail below; subject "You're an operator on *Instance name*"; body: greeting by name, one sentence naming the instance and the operator who created the account, a button labeled "Sign in to *Instance name*" addressing `<instance>/admin`, and the plain sentence that signing in is an emailed link rather than a password. No document, no token) |
| `operator-added-to-document` | an operator is added to a document | that operator | yes (operator message, see § Operator mail below; subject "[Title] — you were added as an operator"; body: greeting by name, one sentence naming the document, who added them and the instance, and a button labeled "Open the dashboard" addressing `<instance>/admin/d/<slug>`. No participant data) |
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

## Operator mail

`operator-magic-link`, `operator-added` and `operator-added-to-document` go to an **operator**, not to a participant, and the rules for participant mail do not reach them:

- **Never preference-gated.** An operator has no participation and no preferences; being given access is not something to opt out of. There is no preference link and no "stop optional messages" footer.
- **Nothing is written to the record.** No `participations.notified` key, no `sent_at`, no commit. These messages are not counted in any document's funnel, and an operator's mailbox never affects what the record says.
- **Never sent to the operator who caused it.** An operator who creates their own record, or adds themselves to a document they already run, is not mailed about their own action.
- **Delivery is recorded in the log and nowhere else.** Each send is logged with the event key, the operator's email and, when the mailer refuses it, the error. It does not enter the failure list that `notifications list` and the dashboard show: that list is the participation dispatcher's, and a retry there re-renders from a participation record an operator does not have — an operator message parked in it could never be retried or cleared.
- **`operator-added` and `operator-added-to-document` are sent after their commit**, and a mailer that refuses one is logged rather than allowed to fail the request: the record or the document membership stands either way, and reporting a failure for a change that happened would be the worse lie. The person may simply have to be told out of band, which is the situation these messages exist to end. (`operator-magic-link` commits nothing, so a refused send is an ordinary request failure and is reported as one.)

Both `operator-added` messages render through the same shell as every other message from the instance (§ Content rules, "Shape"): a greeting by name, one or two plain sentences, exactly one button with the same URL in plain text beneath it, and the small print. They carry no participant's name, email or content, and no personal-link token.

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
- `schedule-changed` says what changed: one line per deadline that moved, with its old and new time ("Comments close moved from Thu, Sep 24 · 5:00 PM EDT to Sat, Sep 26 · 5:00 PM EDT"), before the current clock. A reopening that sets a deadline which had none states the new time alone.
- The digest lists versions published, disposition outcomes for the recipient's comments, and current signatory counts, for the previous 24 hours.
- Subscription messages end with "Manage how we contact you" → `/i/<token>/prefs` and a one-click "stop all optional messages" link that sets every optional preference off (transactional messages continue).
- No message ever includes another participant's contact details or unsubmitted content.
- Subject lines are short and stable: "[Title] — version 3 published", "[Title] — final version, please confirm", "[Title] — you signed", "[Title] — how you're listed changed".

**Shape.** Every message to a participant has the same shape as `operator-magic-link`, so mail from an instance always looks like it comes from one place and never like a form letter or a phishing attempt:

- A greeting by name ("Hi Jane,") using the person's first name when the record has a full name.
- One or two plain sentences in the sender's voice (`documents.sender_name`) saying what happened and what, if anything, the reader is being asked to do. No boilerplate "you are receiving this because".
- While the document is open, the clock in one sentence: "Comments close Thu, Sep 24 · 5:00 PM EDT, and signatures are due Thu, Oct 1 · 5:00 PM EDT." (signing phase: only the second half; closed: "The signatory list closed …"). Dates use the instance time zone with its name and drop the year when it is the current year.
- Exactly one button whose label is the action ("Read and sign", "See what changed", "Confirm or remove your signature", "Sign in to …"), followed by "Or paste this link into your browser:" and the same URL in plain text. At most one further link in the body (for example the full document beneath a "see what changed" button).
- Small print at the end: "This link is yours alone; please don't forward it." and, for subscription messages, the two preference links ("Manage how we contact you" · "Stop optional messages"). Questions go to the document's reply-to, which is the message's Reply-To header, not a line in the body.
- The HTML part and the text part say the same words; the HTML adds only a button in the accent blue and the app's type. No logo, header image, tracking pixel or extra links. No participant token appears anywhere except inside the personal link itself.

## Sending

- Sends are derived, not stored: the commit that causes them (a publish, a phase change, an admin `send`/`remind`) is the trigger; the dispatcher computes recipients from preferences and `notified`, and dispatches with retries (3 attempts, exponential backoff). Failures after the last attempt are logged (person, event, error) and shown, with the same detail, in the dashboard and `notifications list`, from memory.
- Idempotency: the event key is checked against `participations.notified` before dispatch; present means skip. Because recipients are derived from record state, a restart re-derives outstanding sends and the `notified` check keeps them from repeating.
- Preference-suppressed sends are simply not sent; coverage is computed from preferences on demand.
- After a batch (invitation blast, revision alerts) the successes are recorded in **one commit** (`Action: send`, `Comments`-style list of persons in the body) patching each recipient's `notified`, never one commit per recipient.
- **Recorded on success — invitations included.** Nothing enters `notified` until the mailer has accepted the message, and an invitation's `sent_at` is written in the *same* commit as `notified.invitation`. A recipient the mailer rejected is therefore still unsent: the funnel does not count them, the failures list names them with the reason, and the next `send` picks them up with no operator intervention. For an `export` mailer the row is the delivery, so writing it counts as accepted.
- **Every send action reports what it did**, never what it attempted: how many messages were delivered, how many failed, and for each failure the person and the error. `sent_at` and the funnel's "sent" mean delivered.
- **Reminders keep a minimum interval.** A reminder is not sent to anyone this document has messaged within `min_age_hours` (default 48). "Messaged" is any recorded send to that person on this document — invitation, revision alert, phase change, digest, or an earlier reminder; a link export is not a message. People skipped for recency are counted and reported separately from those skipped by the `reminders` preference, so a run that sends nothing says why. An operator who must nudge sooner passes a shorter interval; `0` disables the guard.
- The digest job runs once daily at a configured hour in the instance time zone.

## Principles

**Inherited**

- [Essentials always, everything else opt-in](../principles.md#essentials-always-everything-else-opt-in).
- [Just sign it for now](../principles.md#just-sign-it-for-now): `final-published` and `closing-soon` are forced on for signers because the early-sign promise depends on them.

**Local**

- **A person hears about a version at most once per channel.** If someone has both `every_revision` and `daily_digest` on, the digest omits versions already sent as `v<n>`.
- **A sent count is a delivery count.** Only a message the mailer accepted may be recorded or counted as sent, and every send action reports deliveries and failures rather than intentions. When truth and a tidy number conflict — a partial batch, a rejected address, a reminder the interval refuses — the operator is told what actually happened. An operator who cannot trust the counts has to re-send blind, which is how a coalition emails the same person four times and misses the one person it never reached.
