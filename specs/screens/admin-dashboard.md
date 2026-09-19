# Screen: Admin Dashboard

The team's view of one document's progress. Read-mostly in phase 1; mutations happen through the admin CLI/API, with a few conveniences exposed here.

## Routes

`/admin/login` (magic-link request), `/auth/device` (device approval page), `/admin` (the caller's document list), `/admin/d/<slug>` (dashboard), `/admin/d/<slug>/people`, `/admin/d/<slug>/submissions`, `/admin/d/<slug>/versions`, `/admin/d/<slug>/view-as/<person>`, `/admin/operators`.

## Data Requirements

Everything: document, versions (from body-changing commits), participations with derived statuses, submissions (submitted and draft, labeled) with dispositions, signatures including revoked and conditional, the `notified` tables, and the dispatcher's in-memory failure list.

## Display Rules

**Sign-in** (`/admin/login`): one email field and a button; after submit, always "If that address belongs to an operator, a sign-in link is on its way" (`behaviors/operators.md`). No other text, no link to anything else.

**Device approval** (`/auth/device?code=…`): shows the 8-character user code, the operator it will be bound to (the signed-in one), and "Approve this device" / "Not me"; after approval, "You can close this page; the command line will finish signing in."

**Document list** (`/admin`): only documents the signed-in operator is on: title, state/phase, next deadline, invited / opened / signed counts, a "new document" hint pointing at the CLI. Header shows the operator's email and a sign-out link.

**Operators** (`/admin/operators`): every operator (name, email, kind, active, title, org) with add / edit / deactivate / remove, each requiring a confirmation and showing the resulting commit subject. The signed-in operator cannot deactivate or remove themself here.

**Dashboard** (`/admin/d/<slug>`):
- Header with title, state, phase, both deadlines, and buttons: "Extend deadline…", "Copy public link" (if enabled), "Export feedback" (downloads the bundle from `behaviors/review-and-judgement.md`), "Export links" (CSV; recorded).
- **Operators of this document**: the list with add (choose from active operators) and remove (refused for the last one), per `behaviors/operators.md`.
- **Funnel**: invited → sent → opened → acted (commented, signed, declined) as counts and a bar; signed split into organizations and individuals; conditional signers count; revoked count.
- **Versions**: table (number, date, summary, publisher, dispositions count, final) with "publish a new version" pointing at the CLI and showing the exact command.
- **Recent activity**: the last 50 commits on this document, rendered from their trailers (`Action`, `Person`, `Version`, `Judgement`, `Reason`), which is the record's own event log.
- **Notification health**: sent counts per event from `notified`; queued and failed from the dispatcher (in memory since last start), with a note when the process restarted recently.

**People** (`/admin/d/<slug>/people`): one row per participation: name, org, source, status (`unopened`, `opened`, `drafting`, `commented`, `signed`, `signed (conditional)`, `declined`, `revoked`), first opened, last seen, opens, signature capacity/display, preferences summary, and actions: copy personal link (recorded), revoke link, reissue link, view as, revoke signature (with reason), approve display (**[phase 2]**). Filter by status and source; search by name/org; put filters in the URL. A `drafting` row expands to show the person's draft submission whole under an "Unsubmitted" label.

**Submissions** (`/admin/d/<slug>/submissions`): every submission whole: author, capacity/org, version, judgement (or the badge **unsubmitted**), then its comments in document order, each with heading path and quote, body, and disposition (or `pending` / `unanswered`). Drafts are a separate group by default and never sort among submitted ones. Filter by disposition state, version, judgement and person. A secondary "by passage" view lists comments under the heading they target, but each entry links back to and previews its whole submission. Bulk actions are not offered here; dispositions are set through publish.

**Versions** (`/admin/d/<slug>/versions`): as the participant history plus publisher identity, notes, raw markdown download, dispositions list per version.

**View as** (`/admin/d/<slug>/view-as/<person>`): renders the participant document screen for that person read-only with a persistent banner "Viewing as Jane Doe (read-only)". Every action control is disabled.

## Actions

| Action | Effect |
| --- | --- |
| Extend deadline | dialog with new time (must be later); records and announces per lifecycle |
| Copy personal link / Export links | returns tokens; each is an admin event with actor and count |
| Revoke / reissue link | per `behaviors/access-and-identity.md` |
| Revoke signature | reason required; recorded as admin action; confirmation email to the person |
| Export feedback | downloads the JSON bundle |
| View as | read-only participant render |

Publishing, creating documents, importing invitees and sending are CLI/API only in phase 1; the dashboard shows the commands.

## Navigation

`/admin` ↔ dashboards ↔ sub-pages. Any admin route without a session redirects to `/admin/login` with a return path.

## Principles

**Inherited**
- [Nothing pending is lost; pending is labeled](../principles.md#nothing-pending-is-lost-pending-is-labeled): unsubmitted comments are readable here but always in their own labeled group.
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): every table here is a view of records; nothing shown exists only in the app.

**Local**
- **Admin actions on participants are attributed and explained.** Any admin change to a person's link, signature or listing carries the admin's identity and a reason, and the person is told by email when it affects their signature.
