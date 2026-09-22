# Behavior: Notifications

## Rule

The system sends a small set of **transactional** messages unconditionally and a larger set of **subscription** messages according to each participation's preferences, with role-based defaults. Every message is rendered from a template, carries the recipient's personal link, is recorded on success under `participations.notified.<event>` so it can never be sent twice, and — transactional or subscription alike — ends with the preference links.

## Applies To

Sending on publish, phase transitions, submissions and signature changes; the daily digest job; admin-triggered reminders; `screens/preferences.md`.

## Channels

- **email** (phase 1): via the configured `Mailer`. The From line, the Reply-To and the hostname of every link in the message come from the document's **site** (`behaviors/sites.md` § Mail):
  - **From address**: the site's `sender_email` when it has one — the operator having verified it, or its domain, with the mail provider — otherwise the platform's own verified address (`INSTANCE_FROM_EMAIL`). The service never substitutes one for the other: a site that declared a sender and has not finished verifying it produces delivery failures, not mail from somebody else's address.
  - **From display name**: `documents.sender_name`, else the site's `sender_name`, else the site's `name`. The document's voice wins; the site supplies the default a document may omit.
  - **Reply-To**: `documents.reply_to`, else the site's `reply_to`.
  - **Provider tag**: the site's slug, so per-site delivery statistics exist on one provider account.
  On a deployment with no sites every one of these is the default site's, which is today's behavior unchanged.
- **export**: when the mailer is `export`, "sending" writes rows to a CSV the admin can mail-merge and marks `notified` as if sent.
- **sms** **[phase 2]**: via Twilio; only for `invitation`, `signing-opened`, `closing-soon` and `closed` events; requires `people.phone`. Preferences carry `channel` so the field exists in phase 1.

## Messages

| Event key | Trigger | Recipients | Transactional? |
| --- | --- | --- | --- |
| `invitation` | document opened, or admin "send" for later-added invitations | invitations without `sent_at` | yes |
| `signature-confirmation-<ts>` | a signature written | the signer | yes (names the capacity and says whether the name is on the signatory list, `behaviors/signatures.md` § Display) |
| `revocation-confirmation-<ts>` | a revocation written | the signer | yes |
| `listing-changed-<ts>` | a signature's display fields edited — name, descriptor, organization, title or the listing choice (`behaviors/signatures.md` § Changing how a signature is listed) | the signer | yes (names how they are now listed, and says plainly whether they are named on the list) |
| `review-receipt-<ts>` | a review submitted | the author | yes (brief; lists judgement and comment count) |
| `operator-magic-link` | an operator requests sign-in (web or device code) | that operator | yes (the one message that belongs to the **resolved** site rather than to a document's site, because it is not about a document; not a participation message: no `notified` mark, no preference link; subject "Sign in to *Site name*"; body: greeting by name, one sentence naming the site's URL and what triggered it ("you asked to sign in on the web" or "a command line asked to sign in with code XXXX-YYYY"), a button labeled "Sign in to *Site name*" with the short-code link, the plain-text alternative with the same URL, "This link works once and expires in 15 minutes", and "If you didn't request this, you can ignore this email." Nothing else: no token, no other links) |
| `operator-added` | an operator record is created (`behaviors/operators.md` § Operators) | that operator | yes (operator message, see § Operator mail below; an operator message belongs to the **resolved** site, like `operator-magic-link`, because it is about a site's directory rather than a document; subject "You're an operator on *Site name*"; body: greeting by name, one sentence naming the site and the operator who created the account, a button labeled "Sign in to *Site name*" addressing that site's `/admin`, and the plain sentence that signing in is an emailed link rather than a password. No document, no token) |
| `operator-added-to-document` | an operator is added to a document | that operator | yes (operator message, see § Operator mail below; subject "[Title] — you were added as an operator"; body: greeting by name, one sentence naming the document, who added them and the site, and a button labeled "Open the dashboard" addressing that site's `/admin/d/<slug>`. No participant data) |
| `operator-digest-<date>` | the daily job, only when something happened on the document in the last 24 hours | the document's active operators | yes (operator message, see § Operator mail and § Operator digest below) |
| `operator-first-signature` | the first signature written on a document | the document's active operators | yes (operator message; once per document, § Operator digest) |
| `operator-first-comment` | the first review carrying a comment submitted on a document | the document's active operators | yes (operator message; once per document, § Operator digest) |
| `v<n>` | a version published | invitees with `every_revision` | subscription |
| `digest-<date>` | daily job, only if anything changed that day | invitees with `daily_digest` | subscription |
| `signing-opened` | phase becomes signing (the clock) | all invitees with `phase_changes` who have opened the link, plus every current signer regardless | subscription (signers: forced on) |
| `final-published` | a version with `final = true` published | every current signer, every commenter with `phase_changes`; conditional signers get the confirm/remove variant | subscription (signers: forced on) |
| `closing-soon` | 24 hours before `signing_closes_at` | current signers | subscription (forced on) |
| `closed` | phase becomes closed | signers and commenters with `phase_changes` | subscription |
| `schedule-changed` | admin extends or reopens | invitees with `phase_changes` | subscription |
| `disposition-v<n>` | a version published with dispositions on the recipient's comments | those authors with `my_comments_addressed` | subscription |
| `reminder-<n>` | admin action "remind", targeted at unopened or opened-but-not-acted invitations | targets with `reminders` | subscription |

**"Transactional" means sent unconditionally** — the message goes out whatever the participation's preferences say, and no preference can turn it off. It does *not* mean the message arrives without the controls: every participant message, transactional and subscription alike, ends with the same preference footer (§ Content rules). "Subscription" means the opposite: sent only when the named preference is on.

"Forced on" means the preference toggle is shown disabled with the explanation that signers are always told when the final text lands and when the window closes.

## Operator mail

Every message addressed to an **operator** rather than to a participant — `operator-magic-link`, `operator-added`, `operator-added-to-document`, and the three of § Operator digest below — is governed by these rules, and the rules for participant mail do not reach them:

- **Never preference-gated.** An operator has no participation and no preferences; being given access, or being told what is happening on a document you run, is not something to opt out of. There is no preference link and no "stop optional messages" footer.
- **Nothing is written to a participation.** No `participations.notified` key, no `sent_at`, no commit against a person. These messages are not counted in any document's funnel, and an operator's mailbox never affects what the record says about a participant. The one thing an operator message records is `documents.operator_notified` (§ Operator digest), which exists so a daily message is not sent twice and a once-per-document message is not sent again; it names no person.
- **Never sent to the operator who caused it.** An operator who creates their own record, or adds themselves to a document they already run, is not mailed about their own action. An event with no operator behind it — a participant signing, the digest clock — has nobody to leave out.
- **Delivery is recorded in the log and nowhere else.** Each send is logged with the event key, the operator's email and, when the mailer refuses it, the error. It does not enter the failure list that `notifications list` and the dashboard show: that list is the participation dispatcher's, and a retry there re-renders from a participation record an operator does not have — an operator message parked in it could never be retried or cleared.
- **`operator-added` and `operator-added-to-document` are sent after their commit**, and a mailer that refuses one is logged rather than allowed to fail the request: the record or the document membership stands either way, and reporting a failure for a change that happened would be the worse lie. The person may simply have to be told out of band, which is the situation these messages exist to end. (`operator-magic-link` commits nothing, so a refused send is an ordinary request failure and is reported as one.)

Every operator message renders through the same shell as every other message from the instance (§ Content rules, "Shape"): a greeting by name, one or two plain sentences, exactly one button with the same URL in plain text beneath it, and the small print. The two `operator-added` messages carry no participant's name, email or content at all; the digest and the two first-response notices carry display names and counts and nothing else (§ Operator digest). No operator message ever carries a personal-link token.

## Operator digest

The messages above tell an operator something about their own **access**. These three tell them what is happening on a document they **run** — because otherwise the dashboard is the only signal there is, and a team that has to open the dashboard to learn that four people signed learns it late, or not at all.

- **`operator-digest-<date>`** — once a day, at the instance's digest hour (§ Sending), one message per open document to each of that document's active operators, reporting the previous 24 hours. **Nothing is sent when nothing happened.** A digest that arrives every morning saying nothing happened is a message an operator stops opening, and it is the one that has to be read on the day it isn't empty.
- **`operator-first-signature`** and **`operator-first-comment`** — sent the moment the first signature is written and the first review carrying a comment is submitted, once each per document, whatever the digest reports later the same day. The first response is the thing a team is actually waiting for after it sends a document out, and a day is a long time to wonder whether the link even works.

**Who gets them.** The **document's** operators (`documents.operators`), active ones only — not the site's operator group. The site's group decides who *may* be given a document, not who is running this one (`behaviors/sites.md` § Operators and tenancy); mailing it would send every operator of a site one message per document per day.

**What the digest says.** One line per kind of thing that happened in the window; a kind with nothing in it has no line at all:

- invitations delivered (count)
- first opens (count)
- reviews submitted (count, and who, by display name)
- signatures added and signatures removed (counts, and who, by display name)
- declines (count)
- deadlines moved (one line each, naming the time it moved from and the time it moved to)

Then the document's current signatory counts and its clock, and exactly one button — "Open the dashboard" — on the document's site host.

**Where those facts come from.** Invitations delivered and first opens are counted from the participation records' `sent_at` and `first_opened_at`, each of which is written only when the thing it names actually happened, so the record and the history say the same thing and the record is cheaper to ask. Everything else is read from `git log` over the document's commits in the window, because that is the only place those times exist (`data-model.md` § Commits are the events).

**What no operator message carries.** No email address, no comment text, no individual review's judgement, no personal-link token, and nothing from `people` beyond the display name the dashboard already shows. An operator digest names a person the way the signatory list names them, or not at all.

**What is recorded.** `documents.operator_notified` (`data-model.md` § `documents`): `digest` holds the last date a digest was delivered for this document, `first_signature` and `first_comment` when those two went out. Each is written in one `Action: send` commit on the document, **after** at least one operator message was accepted — a run whose sends all failed is not recorded as sent, and the next run tries again (§ Principles, "A sent count is a delivery count"). It lives on the document because an operator has no per-document record to hold it.

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

- Every message names the document, states the current phase and its next deadline in the recipient's time zone when known (else the document's), and links to the personal link — on the document's site hostname, whichever host the send was triggered from.
- An **operator** message names the document and links to its dashboard on the document's site host instead of to a personal link, because an operator has none (§ Operator digest).
- Revision messages include the version number, the summary line, and a "see what changed" link to the diff.
- `schedule-changed` says what changed: one line per deadline that moved, with its old and new time ("Comments close moved from Thu, Sep 24 · 5:00 PM EDT to Sat, Sep 26 · 5:00 PM EDT"), before the current clock. A reopening that sets a deadline which had none states the new time alone.
- The digest lists versions published, disposition outcomes for the recipient's comments, and current signatory counts, for the previous 24 hours.
- **Every message to a participant** ends with "Manage how we contact you" → `/i/<token>/prefs` and a one-click "stop all optional messages" link that sets every optional preference off (transactional messages continue). Transactional messages carry the pair too, and carrying it does not make them optional: the signing receipt is the one message from a campaign people keep, so it is where someone goes looking for the controls, and a receipt that offers no way to reach them teaches the reader that this sender has none. Operator messages carry neither link (§ Operator mail).
- No message ever includes another participant's contact details or unsubmitted content.
- Subject lines are short and stable: "[Title] — version 3 published", "[Title] — final version, please confirm", "[Title] — you signed", "[Title] — how you're listed changed".

**Shape.** Every message to a participant has the same shape as `operator-magic-link`, so mail from an instance always looks like it comes from one place and never like a form letter or a phishing attempt:

- A greeting by name ("Hi Jane,") using the person's first name when the record has a full name.
- One or two plain sentences in the sender's voice (`documents.sender_name`) saying what happened and what, if anything, the reader is being asked to do. No boilerplate "you are receiving this because".
- While the document is open, the clock in one sentence: "Comments close Thu, Sep 24 · 5:00 PM EDT, and signatures are due Thu, Oct 1 · 5:00 PM EDT." (signing phase: only the second half; closed: "The signatory list closed …"). Dates use the instance time zone with its name and drop the year when it is the current year.
- Exactly one button whose label is the action ("Read and sign", "See what changed", "Confirm or remove your signature", "Sign in to …"), followed by "Or paste this link into your browser:" and the same URL in plain text. At most one further link in the body (for example the full document beneath a "see what changed" button).
- Small print at the end: "This link is yours alone; please don't forward it." and the two preference links ("Manage how we contact you" · "Stop optional messages"). They are small print, not a second call to action — the one-button rule above is unaffected. Questions go to the document's reply-to, which is the message's Reply-To header, not a line in the body.
- The HTML part and the text part say the same words; the HTML adds only a button in the accent color (the site's `accent` when it sets one) and the app's type. No logo, header image, tracking pixel or extra links — a site's `logo_url` is a web-surface identity and never appears in a message, on any site. No participant token appears anywhere except inside the personal link itself.

## Sending

- Sends are derived, not stored: the commit that causes them (a publish, a phase change, an admin `send`/`remind`) is the trigger; the dispatcher computes recipients from preferences and `notified`, and dispatches with retries (3 attempts, exponential backoff). Failures after the last attempt are logged (person, event, error) and shown, with the same detail, in the dashboard and `notifications list`, from memory.
- Idempotency: the event key is checked against `participations.notified` before dispatch; present means skip. Because recipients are derived from record state, a restart re-derives outstanding sends and the `notified` check keeps them from repeating.
- Preference-suppressed sends are simply not sent; coverage is computed from preferences on demand.
- After a batch (invitation blast, revision alerts) the successes are recorded in **one commit** (`Action: send`, `Comments`-style list of persons in the body) patching each recipient's `notified`, never one commit per recipient.
- **Recorded on success — invitations included.** Nothing enters `notified` until the mailer has accepted the message, and an invitation's `sent_at` is written in the *same* commit as `notified.invitation`. A recipient the mailer rejected is therefore still unsent: the funnel does not count them, the failures list names them with the reason, and the next `send` picks them up with no operator intervention. For an `export` mailer the row is the delivery, so writing it counts as accepted.
- **Every send action reports what it did**, never what it attempted: how many messages were delivered, how many failed, and for each failure the person and the error. `sent_at` and the funnel's "sent" mean delivered.
- **Reminders keep a minimum interval.** A reminder is not sent to anyone this document has messaged within `min_age_hours` (default 48). "Messaged" is any recorded send to that person on this document — invitation, revision alert, phase change, digest, or an earlier reminder; a link export is not a message. People skipped for recency are counted and reported separately from those skipped by the `reminders` preference, so a run that sends nothing says why. An operator who must nudge sooner passes a shorter interval; `0` disables the guard.
- The digest job runs once daily at a configured hour in the instance time zone, and the participant digest and the operator digest (§ Operator digest) both run on it.

## Principles

**Inherited**

- [Essentials always, everything else opt-in](../principles.md#essentials-always-everything-else-opt-in).
- [Just sign it for now](../principles.md#just-sign-it-for-now): `final-published` and `closing-soon` are forced on for signers because the early-sign promise depends on them.

**Local**

- **A person hears about a version at most once per channel.** If someone has both `every_revision` and `daily_digest` on, the digest omits versions already sent as `v<n>`.
- **A sender the provider will not accept is a delivery failure, not a substitution.** When a site's `sender_email` is unverified, each affected recipient fails on the ordinary path — nothing enters `notified`, no `sent_at` is written, and the operator is named the recipients and the provider's reason — and the next send picks them up once verification lands. Quietly sending as the platform instead would put a statement in front of signers under a name its own team never chose, and nobody would learn of it from the counts.
- **A sent count is a delivery count.** Only a message the mailer accepted may be recorded or counted as sent, and every send action reports deliveries and failures rather than intentions. When truth and a tidy number conflict — a partial batch, a rejected address, a reminder the interval refuses — the operator is told what actually happened. An operator who cannot trust the counts has to re-send blind, which is how a coalition emails the same person four times and misses the one person it never reached.
