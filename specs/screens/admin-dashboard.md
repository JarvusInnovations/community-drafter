# Screen: Admin Dashboard

The team's view of one document's progress. Read-mostly in phase 1; mutations happen through the admin CLI/API, with a few conveniences exposed here.

## Routes

`/admin/login` (magic-link request), `/auth/device` (device approval page), `/admin` (the caller's document list), `/admin/d/<slug>` (dashboard), `/admin/d/<slug>/people`, `/admin/d/<slug>/submissions`, `/admin/d/<slug>/versions`, `/admin/d/<slug>/view-as/<person>`, `/admin/operators`, `/admin/sites` (superadmin).

Every one of these works on **every** site hostname and is scoped to the site whose host it was reached on: its documents, its operator group, its identity (`behaviors/sites.md` § Operators and tenancy). Admin routes never redirect between hosts; an operator signs in on the hostname they work on, and a superadmin on the default site's host sees every site.

## Data Requirements

Everything: document, versions (from body-changing commits), participations with derived statuses, submissions (submitted and draft, labeled) with dispositions, signatures including revoked and conditional, the `notified` tables, and the dispatcher's in-memory failure list. Plus the session itself (`GET /auth/session`): the signed-in operator, whether they are a superadmin, and the resolved **site** the frame shows — its slug, name, hostname and, where set, logo and accent.

## Display Rules

**Sign-in** (`/admin/login`): one email field and a button; after submit, always "If that address belongs to an operator, a sign-in link is on its way" (`behaviors/operators.md`). No other text, no link to anything else.

**Device approval** (`/auth/device?code=…`): shows the 8-character user code, the operator it will be bound to (the signed-in one), and "Approve this device" / "Not me"; after approval, "You can close this page; the command line will finish signing in."

**Document list** (`/admin`): only documents the signed-in operator is on **within this site** (a superadmin on the default host sees every document on every site, each labeled with its site, with a line saying so): title, state/phase, next deadline, invited / opened / signed counts, a "new document" hint pointing at the CLI. Header shows the operator's email and a sign-out link.

**Operators** (`/admin/operators`): **this site's operator group** (name, email, kind, active, a superadmin pill where set, title, org) with add / edit / deactivate / remove-from-site, each requiring a confirmation and showing the resulting commit subject. The page says which site's group it is. No operator outside the group is listed, offered in a picker, or reachable by typing their email; "Remove" removes the email from this site, and deleting the record outright is offered only to a superadmin and says plainly that it removes the person from every site (`behaviors/sites.md` § Operators and tenancy — the scoping issue #50 asked for). The signed-in operator cannot deactivate or remove themself here.

**Sites** (`/admin/sites`, superadmin, default host): one row per site — hostname, name, the From address mail will actually use (the site's `sender_email`, or the platform address with the site's name), operator count, document count — plus, per row, the **verification hints**: whether the hostname resolves to this service and whether a declared `sender_email` has been accepted by the mail provider, each shown as a plain "not verified yet" state with the DNS record the customer still has to add. Nothing on this page changes DNS; it reports what is true and what is missing (`behaviors/sites.md` § Principles, "A site record never moves DNS"). Creating and editing sites is CLI-only in phase 1, and the page shows the command.

**Dashboard** (`/admin/d/<slug>`):

- Header with title, state, phase and both deadlines. The **audience** is its own line — "Audience: Published for anyone to read" or "Audience: Delivered, not published", followed by "· addressed to *X* and *Y*" whenever `addressed_to` names recipients (`specs/data-model.md` § Audience). It is the promise the sign card makes to every signer, so the team reads it where they read the rest of the document's settings, and it is stated separately from the "Copy public link" affordance, which `public_access` drives and which says only who may read the draft today. Buttons: "Extend deadline…", "Copy public link" (if enabled), **"Download PDF"** (the deliverable — `screens/deliverable.md`; disabled with a reason while the document has no version, and labeled "Download PDF (draft)" while the deliverable is still the watermarked form, so the team reads what they are about to hand someone before they hand it over), "Export feedback" (downloads the bundle from `behaviors/review-and-judgement.md`), "Export links" (CSV; recorded).
- **Site**: the document's site, named, with the hostname its personal and public links are built on, so the team reads the address their participants are actually sent before they send anything (`behaviors/sites.md`). A document on the default site says so rather than showing nothing.
- **Operators of this document**: the list with add (choose from the **document's site's** group) and remove (refused for the last one), per `behaviors/operators.md`.
- **Funnel**: invited → sent → opened → acted (commented, signed, declined) as counts and a bar; a stage whose count is zero draws no segment, because a bar drawn for nothing reads as a small quantity rather than none. Signed split into organizations and individuals; conditional signers count; **revoked signatures and revoked links as two separate counts**, never one — a person whose link was revoked and reissued has withdrawn nothing, and a single "revoked" figure standing beside the signature tiles is read as a withdrawn signature. **Behind the current version** — how many live signatures are attached to an older version (`behaviors/signatures.md` § A signature belongs to a version). It is the number the team needs before marking anything final, so it appears from the moment a second version exists and is shown even when it is zero; **behind the current version** — how many live signatures are attached to an older version (`behaviors/signatures.md` § A signature belongs to a version). It is the number the team needs before marking anything final, so it appears from the moment a second version exists and is shown even when it is zero.
- **Versions**: table (number, date, summary, publisher, dispositions count, final) with "publish a new version" pointing at the CLI and showing the exact command.
- **Recent activity**: the last 50 commits on this document, rendered from their trailers (`Action`, `Person`, `Version`, `Judgement`, `Reason`), which is the record's own event log. A commit made outside the service — a hand edit to the document's record, pushed to the data repo — has no trailers to render and appears as its subject and its git author. Each entry names its actor. **An `extend` or `reopen` entry names every deadline it moved, with the time it moved from and the time it moved to** — an operator reading the feed should not have to open a commit, or their own mail, to learn what the deadline used to be. **A person's first visit is an entry.** The `track` commit that recorded it is expanded into one `opened` entry per person it names (`data-model.md` → `Opened` trailer), reading "opened: Jane Doe"; a `track` commit that recorded no first open is not shown at all, because a return visit is not news and a feed of them would bury the rest. **An actor who is not one of this document's operators and holds `superadmin` is labeled** — "<chris@example.org> (superadmin)" — so a document's own operators can tell an instance administrator acting with standing from an account that should not have been able to write at all (`behaviors/operators.md` § Superadmins). No other actor carries a label.
- **Notification health**: sent counts per event from `notified`; queued and failed from the dispatcher (in memory since last start), with a note saying the figures are counted since the process last started. It also states **when the last operator digest went out** for this document, or that none has yet (`behaviors/notifications.md` § Operator digest) — the team's own mail is the one delivery figure the rest of this panel cannot show, because an operator message writes nothing to any participation. A non-zero failure count is shown with the failures themselves — event, person, time and error — because the count alone tells the team something is wrong and nothing about what.

**People** (`/admin/d/<slug>/people`): one row per participation: name, org, source, status (`not_sent`, `unopened`, `opened`, `drafting`, `commented`, `signed`, `signed_conditional`, `declined`, `revoked`; shown as a pill reading "signed (conditional)" and the like), first opened, last seen, opens, signature capacity/display with the version it is attached to ("personal · v2") and a "behind v3" marker when that version is older than the current one, preferences summary, and actions: copy personal link (recorded), revoke link, reissue link, view as, revoke signature (with reason), approve display (**[phase 2]**). Filter by status and source; search by name/org; put filters in the URL. A `drafting` row expands to show the person's draft submission whole under an "Unsubmitted" label.

**Submissions** (`/admin/d/<slug>/submissions`): every submission whole: author, capacity/org, version, judgement (or the badge **unsubmitted**), then its comments in document order, each with heading path and quote, body, and disposition (or `pending` / `unanswered`). Drafts are a separate group by default and never sort among submitted ones. Filter by disposition state, version, judgement and person; **every filter carries a visible label or is a control whose purpose is self-evident** — a row of bare text boxes beside one real dropdown leaves the team guessing what each accepts. Version and judgement offer the values this document actually has. A secondary "by passage" view lists comments under the heading they target, but each entry links back to and previews its whole submission. Bulk actions are not offered here; dispositions are set through publish.

**Versions** (`/admin/d/<slug>/versions`): as the participant history plus publisher identity, notes, raw markdown download, dispositions list per version. The current version is marked as such, here and in the dashboard's versions table. A version's text is readable in place — the console is where the team reads what it published, and a download is not reading.

**View as** (`/admin/d/<slug>/view-as/<person>`): renders the participant document screen for that person read-only with a persistent banner "Viewing as Jane Doe (read-only)". Every action control is disabled. **The action panel is the participant's own card, not a summary of it**: an unsigned person's view shows the whole sign card — capacity choice, the prefilled name, org and title, the official-capacity attestation in its exact wording, the sign button and the reassurance line — with every input, checkbox, button and link disabled; a signed person's view shows the signed state with its "change how you're listed" / "remove my name" actions disabled. The operator is checking the screen a participant will actually be sent, so replacing it with a sentence like "You didn't sign this document" hides the one thing view-as exists to show. Nothing on the page issues a request. The page has exactly one `h1` (the admin document title above the tabs); the participant header's title and, if the document's own rendered text opens with a top-level heading, that heading each render one level down here so neither duplicates the page title.

## Design

Follows `screens/document.md` § Design (tokens, top bar, cards, buttons, links). Specifics:

- **Frame**: the sticky top bar shows the resolved site's name — read from `GET /auth/session`'s `site` (`api/auth.md`), never a build-time literal and never `INSTANCE_NAME` directly — then a "Operators" link (and "Sites" for a superadmin on the default host), the signed-in operator's email and "Sign out" on the right. The admin frame is the one surface that may name the platform, because the person reading it works there. Pages are centered at 1120 px.
- **Document list and dashboard**: cards. The funnel is a horizontal bar of segments (invited → sent → opened → acted) with counts beneath; signed is split into organizations and individuals as two stat tiles, conditional and revoked as small muted tiles, and the behind-the-current-version count as a small amber tile so a non-zero figure reads as something to act on. Deadlines reuse the timeline component from the participant screen.
- **Tables** (people, submissions, versions, activity): a card with a header row in small muted caps, zebra-free rows separated by the border color, status as small pills (not sent muted, unopened muted, opened blue soft, drafting amber soft, commented blue soft, signed green soft, declined muted, revoked muted with strike), and actions as quiet blue links at the row end. Filters live in a toolbar above the table as selects and a search input in the rounded style; active filters show as removable chips.
- **Submissions page**: each submission is a card: header row with the author avatar and name, capacity/org, version chip and judgement pill (or the amber **unsubmitted** pill), then its comments as bordered rows with heading path, quote and body, each with its disposition pill (pending muted, accepted green, partial blue, declined amber, noted muted).
- **Dialogs** (extend deadline, revoke, reissue, operator and site forms): centered modal cards with a bold title, labeled inputs in the rounded style, a required reason where the spec says so, a primary confirm and a quiet cancel; success shows the resulting commit subject in a green soft banner.
- **Dates**: every absolute time on an admin surface uses `screens/document.md` § Design's date form — "Thu, Sep 24 · 5:00 PM EDT", the year dropped in the current year. A raw locale timestamp ("9/20/2026, 12:35:00 PM") never appears; the team and the participants read the same clock.
- **Phone width**: no admin page scrolls the page sideways at 390 px. The top bar keeps the instance name on one line and truncates it rather than wrapping it into a column, lets the operator's email truncate, and never pushes "Sign out" off the screen. A table wider than its card scrolls inside the card and says so in a small line above it. A select whose options are people's names and addresses takes the width of its column rather than setting it.
- **Sign-in and device pages**: a single centered card at 420 px with the same input and button styles.
- **View as**: the participant screen unchanged — including its sign card — with a full-width amber banner pinned under the top bar. Disabled controls keep their own shape at reduced opacity rather than being replaced by text.

| Action | Effect |
| --- | --- |
| Extend deadline | dialog with new time (must be later); records and announces per lifecycle |
| Copy personal link / Export links | returns tokens; each is an admin event with actor and count |
| Revoke / reissue link | per `behaviors/access-and-identity.md` |
| Revoke signature | reason required; recorded as admin action; confirmation email to the person |
| Download PDF | downloads the deliverable (`screens/deliverable.md`); a read, recorded nowhere |
| Export feedback | downloads the JSON bundle |
| View as | read-only participant render |

Publishing, creating documents, importing invitees and sending are CLI/API only in phase 1; the dashboard shows the commands.

## Navigation

`/admin` ↔ dashboards ↔ sub-pages. Any admin route without a session redirects to `/admin/login` with a return path. The root (`/`) of **every** site hostname shows one card naming that site, one sentence saying documents are reached by personal link, and a "Sign in" button to `/admin/login`; nothing else, per `principles.md` § One instance, many documents, no lobby. A site root lists no documents and names no other site.

## Principles

**Inherited**

- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): unsubmitted comments are readable here but always in their own labeled group.
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): every table here is a view of records; nothing shown exists only in the app.

**Local**

- **Admin actions on participants are attributed and explained.** Any admin change to a person's link, signature or listing carries the admin's identity and a reason, and the person is told by email when it affects their signature.
