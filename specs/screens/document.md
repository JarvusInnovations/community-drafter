# Screen: Document (read and sign)

The page a participant lands on from their personal link. It is the whole product for most people: see the document, sign it, leave.

## Route

`/i/<token>` (personal). The same layout serves `/i/<token>/v/<n>` for an earlier version in read-only form.

## Data Requirements

The participation (person, preferences, position, signature), the document (title, state, phase, deadlines, settings), the current version (or the requested one), the person's comments (submitted and unsubmitted), and signatory counts and list per `show_signatories`.

## Display Rules

Top to bottom:

1. **Instance bar**: the generic instance name, small. No navigation to anything else.
2. **Header**: document title; the phase line ("Comment period · closes Tue Sep 23, 5:00 PM EDT · in 2 days 4 hours"; then "Signatures and removals until Sep 30, 5:00 PM EDT"); the identity line ("You're here as **Jane Doe** · Not you?").
3. **Status card** (the sign card), always above the document text:
   - *Not signed, commenting or signing phase*: heading "Add your name"; capacity choice if more than one allowed; name (prefilled); descriptor or org/title fields per capacity; attestation checkbox for official; the primary button **"Sign as Jane Doe"**; beneath it the reassurance line quoting `signing_closes_at`: "You can remove your name any time until Sep 30. We'll email you when the final version is published." Below the button, two quiet links: "I'd rather not sign" (decline) and "I have comments first" (opens comment mode).
   - *Signed*: "You signed on Sep 19 as Jane Doe, former Academy educator." Actions: "Change how you're listed", "Remove my name", "Add comments" (commenting phase only). If conditional: "You signed conditionally; we'll show you what changed when the final version is published." If a `final` version exists and the signature predates it: "The final text was published Sep 24. **Confirm my signature** · Remove my name".
   - *Declined*: "You told us you won't be signing. Changed your mind? **Sign as Jane Doe**".
   - *Closed*: "The signatory list closed Sep 30." plus the person's own outcome.
   - *Draft exists*: a slim line "You have unsent comments on v2 · Continue" in every state where a draft exists.
4. **Version label**: "Version 3 · published Sep 20 at 9:14 AM EDT · *Tightened term 2; added the collections-care ask* · See what changed · All versions". If viewing an older version: banner "You're reading version 2. **Read the current version (3)**".
5. **The document**: rendered markdown, readable typography, max line length for prose, headings with anchor links. No highlights in this view.
6. **Your comments**: if the person has submitted comments, a collapsed section grouped by submission (version, date, judgement) with disposition badges per comment.
7. **Signatories**: per `show_signatories`: counts line, then organizations, then individuals. Collapsed beyond 20 entries with "show all". Updates on each load.
8. **Footer**: the document's reply-to address as "Questions? Email the team", "Manage how we contact you" (preferences), and a one-line explanation of what this page is ("This is a private link made for you by *sender_name*.").

The page must render its status card and title within the bundle budget in `architecture.md`; the document body and signatory list may stream in after. Nothing on this route depends on cookies or local storage.

Phone width is the primary layout; the sign card is the first thing visible after the title on a phone.

## Actions

| Action | Effect |
| --- | --- |
| Sign | POST signature; on success the card switches to *Signed* and a confirmation email is sent |
| Change how you're listed | edits capacity/name/descriptor/org/title on the existing signature |
| Remove my name | confirmation dialog with optional reason; revokes; card switches to *Not signed* with "You removed your name on Sep 21" |
| Confirm my signature | clears `signature.conditional` (an `Action: resign` commit records when) |
| I'd rather not sign | optional reason; records decline; card switches to *Declined* |
| I have comments first / Add comments / Continue | navigates to comment mode (`/i/<token>/comment`) |
| See what changed / All versions | version history (`/i/<token>/history`) |
| Manage how we contact you | preferences (`/i/<token>/prefs`) |
| Not you? | expands an explanation panel; no state change |

Each action is refused with the phase message when the phase forbids it (`behaviors/document-lifecycle.md`).

## Navigation

Arrives from: the invitation email/SMS, any notification, comment mode, history, preferences (all via the personal link). Leaves to: comment mode, history, preferences. There is nowhere else.

## Principles

**Inherited**
- [Sign first, everything else after](../principles.md#sign-first-everything-else-after): the status card precedes the text; commenting is a link on the card, not a mode you must pass through.
- [Just sign it for now](../principles.md#just-sign-it-for-now): the reassurance line under the sign button is mandatory copy, not optional polish.
- [The link is the identity](../principles.md#the-link-is-the-identity): identity line and "Not you?" on every page.
- [Say exactly who signed](../principles.md#say-exactly-who-signed): the attestation checkbox and the organizations/individuals split.

**Local**
- **The card tells you your own state before anything else.** Whatever else changes on this page, the first sentence a returning participant reads is what they have done and what they can do next.
