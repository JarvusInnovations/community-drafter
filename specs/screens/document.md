# Screen: Document (read and sign)

The page a participant lands on from their personal link. It is the whole product for most people: see the document, sign it, leave.

## Route

`/i/<token>` (personal). The same layout serves `/i/<token>/v/<n>` for an earlier version in read-only form.

## Data Requirements

The participation (person, preferences, signature), the person's position and submissions (submitted and draft), the document (title, state, phase, deadlines, settings), the current version (or the requested one), and signatory counts and list per `show_signatories`.

## Display Rules

Top to bottom:

1. **Instance bar**: the generic instance name, small. No navigation to anything else.
2. **Header**: document title; the identity line ("You're here as **Jane Doe** · Not you?"); the **timeline** (below).
   - **Timeline**: a horizontal track with three labeled points, *Opened* (date), *Comments close* (date), *Signatures due* (date), and a marker for *now*. The segment between the first two points is the comment period and the segment between the last two is the signing period; the segment that contains *now* is drawn as active, elapsed segments as done, future segments as pending, and each state is distinguishable without color (fill pattern or label, not hue alone). Point positions are proportional to time, with a minimum width per segment so a short period stays legible. Above the track, two countdown chips: "Comments close in 4 days 21 hours" and "Signatures due in 11 days 21 hours", each with the absolute time in the participant's zone on a second line; once a deadline has passed its chip reads "Comments closed Sep 24" / "Signing closed Oct 1". Countdowns update live per `behaviors/document-lifecycle.md`. A withdrawn document shows a single line instead of the timeline; a document that has never opened shows the two planned dates with "not yet open".
3. **Status card** (the sign card), always above the document text:
   - *Not signed, commenting or signing phase*: heading "Add your name"; capacity choice if more than one allowed; name (prefilled); descriptor or org/title fields per capacity; attestation checkbox for official; the primary button **"Sign as Jane Doe"**; beneath it the reassurance line quoting `signing_closes_at`: "You can remove your name any time until Sep 30. We'll email you when the final version is published." Below the button, two quiet links: "I'd rather not sign" (decline) and "I have comments first" (opens comment mode).
   - *Signed*: "You signed on Sep 19 as Jane Doe, former Academy educator." The date is the signature **currently in force**, not the first one ever given: after a removal and a later re-signature the card shows the re-signature's time (`behaviors/signatures.md` § Signing). In official capacity the line names the organization — "You signed on Sep 19 for St. Brigid Parish Council as Sr. Margaret Doyle, Chair" — and the sign button reads "Sign for St. Brigid Parish Council". Actions: "Change how you're listed", "Remove my name", "Add comments" (commenting phase only). If conditional: "You signed conditionally; we'll show you what changed when the final version is published." If a `final` version exists and the signature predates it: "The final text was published Sep 24. **Confirm my signature** · Remove my name".
   - *Declined*: "You told us you won't be signing. Changed your mind? **Sign as Jane Doe**".
   - *Closed*: "The signatory list closed Sep 30." plus the person's own outcome.
   - *Draft exists*: a slim line "You have unsent comments on v2 · Continue" in every state where a draft exists.
4. **Version label**: "Version 3 · published Sep 20 at 9:14 AM EDT · *Tightened term 2; added the collections-care ask* · See what changed · All versions". "See what changed" appears only when an earlier version exists; on v1 the label ends with "All versions". If viewing an older version: banner "You're reading version 2. **Read the current version (3)**".
5. **The document**: rendered markdown, readable typography, max line length for prose, headings with anchor links. No highlights in this view. A wide element the prose measure cannot hold — a table, in practice — scrolls horizontally inside its own container; the page itself never scrolls sideways.
6. **Your submissions**: if the person has submitted, a collapsed section listing each submission whole (version, date, judgement, its comments with disposition badges).
7. **Signatories**: per `show_signatories`: counts line, then organizations, then individuals. The counts line reads "Signed by 2 organizations and 14 individuals, and 1 other who asked not to be listed"; a signer who asked not to be listed is counted **once**, in that trailing clause only, and never inside the organizations or individuals figure (`behaviors/signatures.md` § Display). Collapsed beyond 20 entries with "show all". Updates on each load.
8. **Footer**: the document's reply-to address as "Questions? Email the team", "Manage how we contact you" (preferences), and a one-line explanation of what this page is ("This is a private link made for you by *sender_name*.").

The page must render its status card and title within the bundle budget in `architecture.md`; the document body and signatory list may stream in after. Nothing on this route depends on cookies or local storage.

Phone width is the primary layout; the sign card is the first thing visible after the title on a phone.

## Design

The visual design chosen on 2026-09-19 from three concepts (the "Docket" direction). It applies to the participant document screen and its shared parts (timeline, sign card, version label, signatories, footer), to comment mode's frame, and to the public read view; the admin dashboard follows the same tokens.

- **Tokens**: a cool neutral page background with white cards (rounded, 1 px border, no heavy shadows); near-black ink, a muted ink for secondary text, one accent blue for actions and the active period, with a pale blue tint for "current" surfaces; green for done states, an amber tint for the reassurance note. Light scheme only: the page declares a light color scheme and does not follow an OS dark preference; a dark scheme is a future design pass, never an automatic inversion of these tokens. Inter, self-hosted with the app (no third-party font request), with a system sans-serif fallback; the title is heavy and tight, section headings are semibold; no serif, no decorative type.
- **Frame**: a slim sticky top bar with the instance name and a live pill ("Comment period · closes in 4d 21h"). Content is centered at up to 1120 px with 20 px gutters.
- **Header**: the title, then the identity line ("You're here as **Alex Kim** · Not you?") with "Not you?" as a quiet link, then the timeline card.
- **Dates**: absolute times read "Thu, Sep 24 · 5:00 PM EDT" (weekday, date, a middle dot, time with the zone name) and drop the year when it is the current year; date-only points read "Sep 24". Always the reader's zone.
- **Links and quiet actions**: blue, medium weight, no underline at rest and underlined on hover or focus; never the browser default. Anything that acts like a link (a button that opens a panel or a dialog) looks like one. A quiet link that is a real destination on a touch screen — the action panel's "I'd rather not sign" and "I have comments first" in particular — has a tap target at least 44 px tall, and nothing fixed to the viewport may overlap it.
- **Timeline**: the rail form: two countdown chips side by side (label, big relative time, absolute time; the active period's chip in the blue tint with a blue border), then a proportional track (active segment striped in blue, done segment solid green, pending segment a dashed outline), a "today" marker, and the three dated points (Opened, Comments close, Signatures due) under it. Never aligned to columns of text.
- **Layout**: at 960 px and wider, the document card on the left and a sticky action panel (360 px) on the right; on narrower screens the action panel comes first, above the document card, and a sticky bottom bar ("Add your name" / "Sign as Alex Kim" + Sign button) appears only while the panel is scrolled out of view.
- **Action panel (sign card)**: heading "Add your name", a one-line reassurance ("Takes ten seconds. You can always change or remove it."), the unsent-comments notice as a dashed row with a Continue link, a segmented control for capacity, labeled rounded inputs, a full-width blue primary button with a soft shadow, the deadline reassurance in the amber note, and the two quiet links.
- **Document card**: the version chip ("Version 2 · current" in green, or "Version 1" neutral) with date, summary and the history links on one wrapping line; the rendered text below at a comfortable measure, slightly larger than the interface text with a generous line height; section headings semibold, a step above body size, with clear space above them.
- **Signatories card**: heading, a row of initial avatars with the counts sentence, then a responsive grid of chips (initial avatar, name, descriptor or org and title; organization avatars in the deep blue). A chip's name may truncate; its second line — the descriptor, or the person and title behind an organization — wraps instead, so a signer's role is never cut off.
- **Footer**: one quiet line, "Questions? Email the team · Manage how we contact you", then the private-link line; no rule above it.
- **Secondary participant screens** (version history, compare, preferences, the edit-listing form and confirmation dialogs): the same frame, cards, inputs and buttons; nothing on a participant route keeps the pre-design look.

Screenshots of the mock that defines this are in `site/img/` once the live app matches; the mock itself is not versioned.

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
- [Keyboard first, announce every state change](../principles.md#keyboard-first-announce-every-state-change): sign, change listing, remove and decline each move focus to the card's new heading and announce it; the desktop skip link jumps from the action panel to the text.

**Local**

- **The card tells you your own state before anything else.** Whatever else changes on this page, the first sentence a returning participant reads is what they have done and what they can do next.