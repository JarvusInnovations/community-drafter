# Behavior: Notifications

## Rule

Every message to a participant asks something of them, and every one is sent either because the person just did something (a **receipt**) or because an operator ran a command (`principles.md` § Every email asks something of its reader, § Operators speak; state changes don't). Nothing is sent because a phase changed, a deadline moved or a version was published. Every message is rendered from a template, carries the recipient's personal link, is recorded on success under `participations.notified.<event>` so it can never be sent twice, and ends with the preference links.

## Applies To

Receipts for signatures, revocations, listing edits and submissions; the operator commands that reach participants (`docs open`, `people send`, `people remind`, `docs extend|reopen --notify`, `versions publish --notify-commenters`, `docs confirm-call`, `docs delivered`); the daily operator digest; `screens/preferences.md`.

## Channels

- **email** (phase 1): via the configured `Mailer`. The From line, the Reply-To and the hostname of every link in the message come from the document's **site** (`behaviors/sites.md` § Mail):
  - **From address**: the site's `sender_email` when it has one — the operator having verified it, or its domain, with the mail provider — otherwise the platform's own verified address (`INSTANCE_FROM_EMAIL`). The service never substitutes one for the other: a site that declared a sender and has not finished verifying it produces delivery failures, not mail from somebody else's address.
  - **From display name**: `documents.sender_name`, else the site's `sender_name`, else the site's `name`. The document's voice wins; the site supplies the default a document may omit.
  - **Reply-To**: `documents.reply_to`, else the site's `reply_to`.
  - **Provider tag**: the site's slug, so per-site delivery statistics exist on one provider account.
  On a deployment with no sites every one of these is the default site's, which is today's behavior unchanged.
- **export**: when the mailer is `export`, "sending" writes rows to a CSV the admin can mail-merge and marks `notified` as if sent.
- **sms** **[phase 2]**: via Twilio; only for `invitation`, `reminder` and `confirm-call`; requires `people.phone`. Preferences carry `channel` so the field exists in phase 1.

## Segments

Every recipient rule below is written in these terms. Each is a fact about one participation on one document, derived at send time; a revoked link is in none of them.

| Segment | Who |
| --- | --- |
| **U** | invited (the invitation was delivered), never opened their link |
| **O** | opened, undecided: has opened their link, holds no current signature and has not declined. May have commented |
| **S** | signed on the current version: a current signature whose `signed_on_version` is the current version and which is not conditional |
| **S-behind** | signed on an older version: a current, unconditional signature whose `signed_on_version` is lower than the current version |
| **C** | a current signature with `conditional = true`, on any version |
| **D** | declined, or removed their name: their current position is `decline`, or they hold only a revoked signature and have not signed again |
| **Op** | an operator of the document (not a participant; § Operator mail) |

"Current signer" means S, S-behind and C together. A person moves between segments only by acting (opening, signing, removing, declining, confirming) — never because a version was published, except that a publish turns S into S-behind.

## Messages

| Message | Triggered by | Reaches | Why they care | What they can do |
| --- | --- | --- | --- | --- |
| `invitation` | operator: `docs open`, `people send` | invitations without `sent_at` (they become U) | they are being asked to put their name to something | open it; sign, comment, or decline |
| `signature-confirmation-<ts>` | automatic: a signature written, from the sign card or a signing submission | the signer | it is their record of what they put their name to and how it reads | nothing required — **exception**; it says what happens next and how to change or remove the name |
| `revocation-confirmation-<ts>` | automatic: a signature revoked, by the signer or an operator | the person | their name came off; if it wasn't them, they need to know | sign again |
| `listing-changed-<ts>` | automatic: a signature's display fields edited (`behaviors/signatures.md` § Changing how a signature is listed) | the signer | how they are publicly named changed | if it wasn't them, change it back |
| `review-receipt-<ts>` | automatic: a submission with judgement `comment` or `decline` | the author | their comments or their decline were received | `comment`: add more comments until comments close; `decline`: sign after all, until signing closes |
| `reminder-<n>` | operator: `people remind --target unopened\|opened-not-acted` | U and/or O as targeted, with `reminders` on and not messaged within `min_age_hours` | a deadline is coming and they have not answered | sign or decline before the named deadline |
| `schedule-changed-<ts>` | operator: `docs extend … --notify`, `docs reopen … --notify` | O | they have not answered, and now have more time | sign or decline by the new deadline |
| `disposition-v<n>` | operator: `versions publish … --notify-commenters` | authors whose comments got a disposition in this publish, in O, S, S-behind, C or D, with `my_comments_addressed` on | they asked for a change and this is the answer | read the new text; sign, remove their name, or comment |
| `confirm-call-<ts>` | operator: `docs confirm-call` | S-behind and C | the text changed since they signed, or they signed on a condition | keep their name on the current text, or remove it, by the stated date |
| `delivered` | operator: `docs delivered` | every current signer (S, S-behind, C) | the statement they signed went where it was going | nothing — **exception**; it is the outcome |
| `operator-magic-link` | an operator requests sign-in (web or device code) | that operator | they asked to sign in | sign in |
| `operator-added` | an operator record is created (`behaviors/operators.md` § Operators) | that operator | they were given access | sign in |
| `operator-added-to-document` | an operator is added to a document | that operator | they now run a document | open the dashboard |
| `operator-digest-<date>` | the daily job, only when something happened on the document in the last 24 hours | the document's active operators | what happened on a document they run | open the dashboard |
| `operator-first-signature` | the first signature written on a document | the document's active operators | the first response is the one the team is waiting for | open the dashboard |

`<ts>` is the moment of the action or command that caused the message, so each receipt, each `schedule-changed` and each `confirm-call` reaches a person once for that occasion and again for the next one.

**Nothing else is sent.** In particular there is no message when signing opens, when it is about to close, when it closes, when a version is published (to anyone who did not comment on it, or at all without `--notify-commenters`), and no daily summary to participants. Those are state changes; the operator decides what, if anything, the pool is told about them (`principles.md` § Operators speak; state changes don't).

**Always sent, and preference-gated.** The invitation, the receipts, `schedule-changed`, `confirm-call` and `delivered` go out whatever the participation's preferences say: an operator asked for them, or the person caused them. `reminder-<n>` needs `reminders`, and `disposition-v<n>` needs `my_comments_addressed` (§ Defaults). Every participant message, whether or not a preference gates it, ends with the same preference footer (§ Content rules).

**D hears only about themselves.** A person in D receives the receipts for their own actions and, when an operator asks for it with `--notify-commenters`, `disposition-v<n>`: a decliner who commented asked for a change and is owed the answer. Nothing else reaches them — not a reminder (their status is neither `unopened` nor `opened`), not `schedule-changed`, not `confirm-call`, not `delivered`.

### What each message says

- **`signature-confirmation-<ts>`** names the capacity and how the name reads, says whether it is on the signatory list (`behaviors/signatures.md` § Display), and then **What happens next**, which promises exactly what the rest of this table will send and nothing more:
  - "If the text changes before it's delivered, we'll ask you once to confirm your signature." — for a conditional signature: "Because you signed on a condition, we'll ask you to confirm before it's delivered." Omitted once the document has been delivered.
  - "We'll let you know when it's delivered to *the State Board of Education*." — `addressed_to` joined with commas and a final "and", or "its recipients" when it names none. Omitted once delivered; a signature given after delivery says instead "It was delivered to … on *Sep 30*."
  - "You can change how you're listed or remove your name any time until *Thu, Oct 1 · 5:00 PM EDT*." — `signing_closes_at`, with the personal link as the button.
  A signing **submission** from comment mode sends this one message, not a review receipt as well; it adds "We received your *3 comments* too." when the submission carried any.
- **`review-receipt-<ts>`** is sent only when it has an action to name. For `comment`: the comment count and "You can add more comments until *comments close*." — not sent if comments have already closed. For `decline`: "Changed your mind? You can still sign until *signing closes*." — not sent once signing has closed.
- **`reminder-<n>`** carries the deadline and the ask in its first sentence: "Signing closes *Wed, Sep 23 · 2 PM EDT*. Sign or decline." (during the comment period: "Comments close …, and signing closes …"). It is the last call: nothing automatic follows it.
- **`schedule-changed-<ts>`** says there is more time, deadline by deadline: "More time: signing now closes *Sat, Sep 26 · 5:00 PM EDT* (it was *Thu, Sep 24 · 5:00 PM EDT*)." A reopening that sets a deadline which had none states the new time alone. Deadlines only move later (`behaviors/document-lifecycle.md`), so it never says a deadline came sooner.
- **`disposition-v<n>`** lists the recipient's own comments' outcomes (never another person's), with "See what changed" addressing the comparison into the new version.
- **`confirm-call-<ts>`**: subject "*Title* — the text changed since you signed" (S-behind) or "*Title* — please confirm your conditional signature" (C). One sentence saying what changed ("You signed version 2; the current text is version 4.") or that they signed on a condition; "Please keep your name on the current text or remove it by *Wed, Sep 30 · 5:00 PM EDT*" (the operator's `--by`, else `signing_closes_at`); "If you do nothing, your name stays on it." The button is "Keep or remove my name" to the personal link, whose card offers both (`screens/document.md` § Display Rules 3); the one further link is "See what changed since version *n*", the comparison from the version they signed to the current one, present whenever those differ.
- **`delivered`**: subject "*Title* — delivered". "*Title* was delivered to *the State Board of Education* on *Sep 30*." then the operator's note when given, then the signatory count as it stood at delivery. The button is "Read the statement".

## What a participant hears, start to finish

The table above is the catalogue; this is the same thing from one person's side, in the order it happens.

1. **Invited.** The invitation arrives when an operator sends it. Until they open their link (U), the only other thing they can receive is a reminder, when an operator runs one and `reminders` is on.
2. **Their own actions, always.** Every signature they add or remove, change to how they are listed, and comment or decline they submit produces a receipt, and each receipt names what they can do next.
3. **Opened, not yet answered (O).** They hear from the team only when the team asks: a reminder before a deadline ("Sign or decline"), and, if the team gives more time and says so, `schedule-changed`. If they commented, they may also hear what happened to their comments (`disposition-v<n>`), when the team publishes with `--notify-commenters`. No message tells them a window opened or closed.
4. **Signed (S).** Their receipt told them what comes next, and nothing else arrives until it does:
   - **If the text changes after they sign (S-behind), or they signed on a condition (C),** the team runs a confirm-call before delivery, and they are asked once to keep their name on the current text or remove it. Keeping moves them back to S.
   - **When the statement is delivered,** they are told where it went and when (`delivered`). That is the last message.
5. **Declined or removed their name (D).** Receipts for their own actions, and `disposition-v<n>` if they commented and the team asks for it. Nothing about the clock, the text or the outcome. A later signature makes them a signer again, from step 4.

## Operator mail

Every message addressed to an **operator** rather than to a participant — `operator-magic-link`, `operator-added`, `operator-added-to-document`, and the two of § Operator digest below — is governed by these rules, and the rules for participant mail do not reach them:

- **Never preference-gated.** An operator has no participation and no preferences; being given access, or being told what is happening on a document you run, is not something to opt out of. There is no preference link and no "stop optional messages" footer.
- **Nothing is written to a participation.** No `participations.notified` key, no `sent_at`, no commit against a person. These messages are not counted in any document's funnel, and an operator's mailbox never affects what the record says about a participant. The one thing an operator message records is `documents.operator_notified` (§ Operator digest), which exists so a daily message is not sent twice and a once-per-document message is not sent again; it names no person.
- **Never sent to the operator who caused it.** An operator who creates their own record, or adds themselves to a document they already run, is not mailed about their own action. An event with no operator behind it — a participant signing, the digest clock — has nobody to leave out.
- **Delivery is recorded in the log and nowhere else.** Each send is logged with the event key, the operator's email and, when the mailer refuses it, the error. It does not enter the failure list that `notifications list` and the dashboard show: that list is the participation dispatcher's, and a retry there re-renders from a participation record an operator does not have — an operator message parked in it could never be retried or cleared.
- **`operator-added` and `operator-added-to-document` are sent after their commit**, and a mailer that refuses one is logged rather than allowed to fail the request: the record or the document membership stands either way, and reporting a failure for a change that happened would be the worse lie. The person may simply have to be told out of band, which is the situation these messages exist to end. (`operator-magic-link` commits nothing, so a refused send is an ordinary request failure and is reported as one.)

Every operator message renders through the same shell as every other message from the instance (§ Content rules, "Shape"): a greeting by name, one or two plain sentences, exactly one button with the same URL in plain text beneath it, and the small print. The two `operator-added` messages carry no participant's name, email or content at all; the digest and the first-signature notice carry display names and counts and nothing else (§ Operator digest). No operator message ever carries a personal-link token.

## Operator digest

The messages above tell an operator something about their own **access**. These two tell them what is happening on a document they **run** — because otherwise the dashboard is the only signal there is, and a team that has to open the dashboard to learn that four people signed learns it late, or not at all.

- **`operator-digest-<date>`** — once a day, at the instance's digest hour (§ Sending), one message per document that was open at any point in the window (so the day signing closes is reported) to each of that document's active operators, reporting the previous 24 hours. **Nothing is sent when nothing happened.** A digest that arrives every morning saying nothing happened is a message an operator stops opening, and it is the one that has to be read on the day it isn't empty.
- **`operator-first-signature`** — sent the moment the first signature is written, once per document, whatever the digest reports later the same day. The first signature is the thing a team is actually waiting for after it sends a document out, and a day is a long time to wonder whether the link even works. (There is no first-comment notice: a comment reaches the team in the next digest, and the team's own mailbox is not exempt from § Every email asks something of its reader.)

**Who gets them.** The **document's** operators (`documents.operators`), active ones only — not the site's operator group. The site's group decides who *may* be given a document, not who is running this one (`behaviors/sites.md` § Operators and tenancy); mailing it would send every operator of a site one message per document per day.

**What the digest says.** One line per kind of thing that happened in the window; a kind with nothing in it has no line at all:

- invitations delivered (count)
- first opens (count)
- reviews submitted (count, and who, by display name)
- signatures added and signatures removed (counts, and who, by display name)
- declines (count)
- deadlines moved (one line each, naming the time it moved from and the time it moved to)
- signing closed (the time it closed, and the final signatory count)
- confirm-calls sent (how many signers each one reached)
- delivered (to whom and when)

Then the document's current signatory counts and its clock, and exactly one button — "Open the dashboard" — on the document's site host.

**Where those facts come from.** Invitations delivered and first opens are counted from the participation records' `sent_at` and `first_opened_at`, each of which is written only when the thing it names actually happened, so the record and the history say the same thing and the record is cheaper to ask. Everything else is read from `git log` over the document's commits in the window, because that is the only place those times exist (`data-model.md` § Commits are the events).

**What no operator message carries.** No email address, no comment text, no individual review's judgement, no personal-link token, and nothing from `people` beyond the display name the dashboard already shows. An operator digest names a person the way the signatory list names them, or not at all.

**What is recorded.** `documents.operator_notified` (`data-model.md` § `documents`): `digest` holds the last date a digest was delivered for this document, `first_signature` when that notice went out (a `first_comment` written by an earlier build is ignored). Each is written in one `Action: send` commit on the document, **after** at least one operator message was accepted — a run whose sends all failed is not recorded as sent, and the next run tries again (§ Principles, "A sent count is a delivery count"). It lives on the document because an operator has no per-document record to hold it.

## Defaults

Set when the participation is created, editable by the participant at any time:

| Preference | Default |
| --- | --- |
| `channel` | `email` |
| `my_comments_addressed` | on — gates `disposition-v<n>` |
| `reminders` | on — gates `reminder-<n>`; turned off automatically when the person signs, comments or declines |

These are the only two. Every other message is either a receipt for the person's own action or something an operator deliberately sent, and neither is a thing to subscribe to. The preferences `every_revision`, `daily_digest` and `phase_changes` existed in earlier builds; a record that still carries them is read without error, and nothing consults them.

## Content rules

- Every message names the document, states the current phase and its next deadline in the recipient's time zone when known (else the document's), and links to the personal link — on the document's site hostname, whichever host the send was triggered from.
- An **operator** message names the document and links to its dashboard on the document's site host instead of to a personal link, because an operator has none (§ Operator digest).
- Every message says, in its body, what the reader can do and by when (§ Messages, "What each message says"); the two exceptions (the signing receipt and `delivered`) say what happens next instead.
- A message that mentions a version links to the comparison into it ("See what changed").
- **Every message to a participant** ends with "Manage how we contact you" → `/i/<token>/prefs` and a one-click "stop all optional messages" link that sets every optional preference off (transactional messages continue). Transactional messages carry the pair too, and carrying it does not make them optional: the signing receipt is the one message from a campaign people keep, so it is where someone goes looking for the controls, and a receipt that offers no way to reach them teaches the reader that this sender has none. Operator messages carry neither link (§ Operator mail).
- No message ever includes another participant's contact details or unsubmitted content.
- Subject lines are short and stable: "[Title] — you signed", "[Title] — how you're listed changed", "[Title] — the text changed since you signed", "[Title] — more time to sign", "[Title] — delivered".

**Shape.** Every message to a participant has the same shape as `operator-magic-link`, so mail from an instance always looks like it comes from one place and never like a form letter or a phishing attempt:

- A greeting by name ("Hi Jane,") using the person's first name when the record has a full name.
- One or two plain sentences in the sender's voice (`documents.sender_name`) saying what happened and what, if anything, the reader is being asked to do. No boilerplate "you are receiving this because".
- While the document is open, the clock in one sentence: "Comments close Thu, Sep 24 · 5:00 PM EDT, and signatures are due Thu, Oct 1 · 5:00 PM EDT." (signing phase: only the second half; closed: "The signatory list closed …"). Dates use the instance time zone with its name and drop the year when it is the current year.
- Exactly one button whose label is the action ("Read and sign", "See what changed", "Keep or remove my name", "Sign in to …"), followed by "Or paste this link into your browser:" and the same URL in plain text. At most one further link in the body (for example the full document beneath a "see what changed" button).
- Small print at the end: "This link is yours alone; please don't forward it." and the two preference links ("Manage how we contact you" · "Stop optional messages"). They are small print, not a second call to action — the one-button rule above is unaffected. Questions go to the document's reply-to, which is the message's Reply-To header, not a line in the body.
- The HTML part and the text part say the same words; the HTML adds only a button in the accent color (the site's `accent` when it sets one) and the app's type. No logo, header image, tracking pixel or extra links — a site's `logo_url` is a web-surface identity and never appears in a message, on any site. No participant token appears anywhere except inside the personal link itself.

## Sending

- Sends are derived, not stored: the commit that causes them (a person's own action, or an operator's command) is the trigger; the dispatcher computes recipients from preferences and `notified`, and dispatches with retries (3 attempts, exponential backoff). Failures after the last attempt are logged (person, event, error) and shown, with the same detail, in the dashboard and `notifications list`, from memory.
- Idempotency: the event key is checked against `participations.notified` before dispatch; present means skip. Because recipients are derived from record state, a restart re-derives outstanding sends and the `notified` check keeps them from repeating.
- Preference-suppressed sends are simply not sent; coverage is computed from preferences on demand.
- After a batch (invitation blast, reminders, a `--notify`, a confirm-call) the successes are recorded in **one commit** (`Action: send`, `Comments`-style list of persons in the body) patching each recipient's `notified`, never one commit per recipient.
- **Recorded on success — invitations included.** Nothing enters `notified` until the mailer has accepted the message, and an invitation's `sent_at` is written in the *same* commit as `notified.invitation`. A recipient the mailer rejected is therefore still unsent: the funnel does not count them, the failures list names them with the reason, and the next `send` picks them up with no operator intervention. For an `export` mailer the row is the delivery, so writing it counts as accepted.
- **Every send action reports what it did**, never what it attempted: how many messages were delivered, how many failed, and for each failure the person and the error. `sent_at` and the funnel's "sent" mean delivered.
- **A command that can reach people says how many first.** `docs extend|reopen` without `--notify` and `versions publish` without `--notify-commenters` send nothing and report how many people the flag would have reached; with `--dry-run` (extend, reopen, confirm-call, delivered, remind, send) nothing is written or sent and the would-be recipients are counted. With the flag, the response reports deliveries and failures like every other send.
- **A person hears about a `schedule-changed` or a `confirm-call` once per command.** The event key carries the command's timestamp, so running `docs extend --notify` twice reaches the O segment twice — once per extension — and never twice for the same one.
- **No automatic last call.** The team decides when to remind (`people remind`); the dashboard suggests it when a deadline is within 48 hours and people are still in U or O (`screens/admin-dashboard.md`). A reminder is the last call and says so by naming the deadline.
- **Reminders keep a minimum interval.** A reminder is not sent to anyone this document has messaged within `min_age_hours` (default 48). "Messaged" is any recorded send to that person on this document — invitation, receipt, `schedule-changed`, disposition, confirm-call, or an earlier reminder; a link export is not a message. People skipped for recency are counted and reported separately from those skipped by the `reminders` preference, so a run that sends nothing says why. An operator who must nudge sooner passes a shorter interval; `0` disables the guard. An operator may also name the people to remind (`--person`); naming someone narrows the run and overrides nothing — the target segment, the interval and the `reminders` preference apply to them as to anyone, and each named person who is not reminded is reported by name with the reason.
- The operator digest (§ Operator digest) runs once daily at a configured hour (`INSTANCE_DIGEST_HOUR`, default 8) in the instance time zone. It is run by the scheduler tick (`architecture.md` § Deployment), which arrives every 15 minutes whether or not the service is running and starts it if it is not; the digest goes out on the first tick inside the digest hour that finds something to report, and `documents.operator_notified` keeps the later ticks in that hour from sending it again. Nothing about it depends on a timer inside the process, so a service that scaled to zero overnight still sends the morning digest. It is the only scheduled sender; nothing scheduled ever mails a participant.

## Principles

**Inherited**

- [Every email asks something of its reader](../principles.md#every-email-asks-something-of-its-reader): the "What they can do" column is not decoration — a row without an entry there is not sent, except the signing receipt and `delivered`.
- [Operators speak; state changes don't](../principles.md#operators-speak-state-changes-dont): every row is a receipt or an operator's command; phase changes, schedule changes and publishes send nothing on their own.
- [Essentials always, everything else opt-in](../principles.md#essentials-always-everything-else-opt-in): two preferences, and the rest either receipts or deliberate operator messages.
- [Just sign it for now](../principles.md#just-sign-it-for-now): the signing receipt promises one confirm-call before delivery and a `delivered` message, and `confirm-call` and `delivered` are the messages that keep those promises.

**Local**

- **Promise nothing the matrix won't send.** Every "we'll let you know" in a message or on a card names a row of § Messages. A promise the system cannot keep without an operator (the confirm-call, `delivered`) is still made, because the team runs those commands as part of delivering; a promise nobody sends (a message when signing closes) is never made.
- **A sender the provider will not accept is a delivery failure, not a substitution.** When a site's `sender_email` is unverified, each affected recipient fails on the ordinary path — nothing enters `notified`, no `sent_at` is written, and the operator is named the recipients and the provider's reason — and the next send picks them up once verification lands. Quietly sending as the platform instead would put a statement in front of signers under a name its own team never chose, and nobody would learn of it from the counts.
- **A sent count is a delivery count.** Only a message the mailer accepted may be recorded or counted as sent, and every send action reports deliveries and failures rather than intentions. When truth and a tidy number conflict — a partial batch, a rejected address, a reminder the interval refuses — the operator is told what actually happened. An operator who cannot trust the counts has to re-send blind, which is how a coalition emails the same person four times and misses the one person it never reached.
