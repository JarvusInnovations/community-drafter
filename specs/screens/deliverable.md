# Screen: The Deliverable

The finished thing. Every other surface in this system exists to produce one artifact: the statement, its date and version, and the people and organizations who put their names to it, on paper. It is a PDF, rendered on demand, and it is the file a coalition attaches to an email, hands to a board, or uploads to a press page.

It is not a screen a participant navigates to and not a route in the SPA. It is a document the service renders and serves, and the three doors onto it — operator, participant, public — differ only in who may open them.

## Routes

| Route | Who | Gate |
| --- | --- | --- |
| `GET /admin/api/documents/<slug>/statement.pdf` | operators of the document | `api/admin.md` (document-scoped) |
| `GET /i/<token>/api/statement.pdf` | anyone holding a personal link | `api/participant.md` |
| `GET /d/<slug>/statement.pdf` | anyone | `audience = public` **and** `public_access != none` |

The response is `application/pdf` with a `Content-Disposition: attachment` filename of `<slug>-v<n>.pdf`, or `<slug>-v<n>-draft.pdf` while the deliverable is a draft (§ Draft and clean).

Every route lives on the document's **site** hostname and redirects to it exactly as its neighbours do (`behaviors/sites.md`). The public route 404s — with the body every other `/d/<slug>/*` route 404s with, so a private statement and a slug that never existed answer identically — when the slug is unknown, when `state = draft`, when `public_access = none`, **and when `audience = closed`**. A statement addressed to a named body is delivered to that body; publishing a download of it to anyone who guesses the slug is exactly the disclosure `audience` exists to prevent. The other two doors do not consult `audience` at all: an operator and an invited signer may both already read every word on their own screens.

There is no route for an older version. The deliverable is the current version and nothing else; an earlier version is a thing to read in the history, not a thing to hand anyone.

## Availability

The deliverable exists from the moment a document has its first version. Before that — a `draft` document with no version — every door answers `not_found`, because there is no text to render.

A `withdrawn` document renders nothing on any door: the statement was taken back, and a file that outlives the withdrawal is the one artifact that could keep circulating after the team stopped standing behind it.

## Draft and clean

The deliverable is **draft** until the document has a version marked `final` **and** signing has closed (phase `closed`), and **clean** from that moment on. Both conditions, because either alone leaves something still moving: a final text whose signatory list is still taking names, or a closed list under text the team has not called final.

A draft render carries, on every page, a diagonal **DRAFT** watermark; under the title block, the line "Draft of version *n* — the text and the signatory list may still change."; and the words "DRAFT · version *n*" in the running footer. A clean render carries none of the three and is otherwise byte-for-byte the same document.

Operators may render either. Participants and the public get whichever the document currently is — nobody is offered a clean copy of an unfinished statement, and nobody is handed a watermark over a finished one.

## Data Requirements

The document (`title`, `audience`, `addressed_to`, `state`, `show_signatories`), its derived phase, its **site** (`name`, and the site's own address), the **current version** (number, published date, `final`, and the same sanitized HTML the document screen renders — `architecture.md` § API server), and the signatory counts and list computed exactly as every other surface computes them (`behaviors/signatures.md` § Display).

Nothing else. In particular: no comments, no submissions, no dispositions, no version history, no deadlines, no funnel, no tracking, and **nothing from the `people` sheet** — a signatory's name, descriptor, organization and title come from their own `signature`, which is what they chose to have shown, and a contact address never reaches this file.

## Display Rules

Top to bottom:

1. **Site line** — the document's site's `name`, small and quiet, above the title block. The site's `logo_url` is deliberately *not* used: it is a URL the renderer would have to fetch, and the deliverable never makes a network request to produce itself.
2. **Title block**
   - "To: *the State Board of Education*" whenever `addressed_to` names recipients, several joined with commas and a final "and" (`data-model.md` § Audience). Absent when it names none, on a `public` or a legacy `closed` document alike.
   - The document `title`.
   - One meta line: "Version *n* · *Sep 20, 2026*", plus " · final text" when the version is marked `final` (`behaviors/versioning.md` § The label). The date is the version's publication date in the instance time zone, written `Sep 20, 2026` — with the year always, unlike a screen's date-only point (`screens/document.md` § Design), because a printed statement outlives the year it was printed in and is read by people who were not in the room.
   - The draft note, when the deliverable is a draft (§ Draft and clean).
3. **The statement** — the current version's rendered text, the same HTML the document screen shows, with the same heading hierarchy, lists and tables. Anchor links, highlights, comment markers and block ids leave no visible trace. A table wider than the measure shrinks to fit rather than clipping; nothing runs off the page.
4. **Signatories**, honoring `show_signatories` exactly as every other surface does:
   - `list` — the counts line, then **Organizations** (official capacity, alphabetically by `org`) as "*Skype a Scientist* — Jane Doe, Executive Director", then **Individuals** (personal capacity, earliest signature first) as "Jane Doe, former Academy educator" or bare when there is no descriptor.
   - `count` — the counts line alone.
   - `none` — the section is absent entirely, and so is its heading.
   - The counts line is the sentence `behaviors/signatures.md` § Display defines, ending with "and 3 others who asked not to be listed" when any current signatory asked not to be named. An unlisted signer is counted once, there and nowhere else.
   - A document with no current signatories at all says "No signatories yet." under the heading rather than printing an empty list.
5. **Running footer**, repeated on every page: the site's name, the statement's public address when it has one (`https://<site hostname>/d/<slug>`, printed only when the public door is actually open — a URL that 404s is worse than no URL), and "Page *n* of *m*". A draft's footer leads with "DRAFT · version *n*".

Conditional signatures, signatures behind the current version and re-affirmed signatures are all rendered identically to any other (`behaviors/signatures.md` § Principles, "Public display is uniform"). Nothing on this page distinguishes them, and nothing on it is addressed to the team.

## Design

The deliverable is a printed document, not a screenshot of a web page. It follows `screens/document.md` § Design for type and color, and departs from it wherever paper differs from a screen.

- **Paper**: US Letter by default, A4 on request. The measure, margins and type sizes are chosen so both read correctly with no reflow surprises; nothing is positioned against one paper's width.
- **Type**: Inter, self-hosted with the app and embedded in the render, with a system sans-serif fallback; no third-party font request, on paper as on screen. The statement's text sits a step above the interface size with a generous line height, as it does on the document card.
- **Color**: near-black ink on white, the muted ink for the site line and the meta line, and the accent (the site's own, when it sets one) for the section rules and the organization names. Nothing depends on color to be understood: the watermark is text, the draft note is a sentence, and the signatory sections are labeled headings.
- **Watermark**: the word DRAFT, set large and diagonally across the page in a pale tint, behind the text and never over it to the point of illegibility.
- **Page breaks**: a heading never ends a page alone; the Signatories heading and its counts line never separate from the first names beneath them; and no signatory's name is split from the line that describes them. Paragraphs keep at least two lines on either side of a break.

## Actions

None. It is a file. The three surfaces that offer it are:

| Surface | Offer |
| --- | --- |
| Admin dashboard (`screens/admin-dashboard.md`) | "Download PDF" beside the other exports |
| Participant document screen (`screens/document.md`) | "Download the statement (PDF)" in the footer |
| Public read view (`screens/public-and-embed.md`) | the same footer link, when the public door is open |
| Admin CLI (`api/admin-cli.md`) | `drafter-axi docs export <slug> --pdf [--out <file>]` |

## Navigation

None from the file; the file is an endpoint of the flow, not a station on it.

## Principles

**Inherited**

- [Say exactly who signed](../principles.md#say-exactly-who-signed): the counts and the list here are the same query every other surface runs, and no other count is blended into them.
- [The record is a git repo the team can read without the app](../principles.md#the-record-is-a-git-repo-the-team-can-read-without-the-app): the PDF is derived on demand and never written into the data repo. It is a view, and a view that got stored would be a second copy of the record free to disagree with it.
- [Versions are for normies](../principles.md#versions-are-for-normies): "Version 3 · Sep 20, 2026", never a hash and never the word "commit".

**Local**

- **The deliverable says exactly what the record says at the moment it is rendered.** Nothing about it is frozen, snapshotted or stored. The signatory list is computed live on every render, so a name revoked after closing — an operator revocation at the signer's request (`behaviors/signatures.md` § Revocation) — is simply not in the next copy, and the previously downloaded file is stale rather than authoritative. The cost is that two copies of the same "final" statement can differ; that cost is the point. A signatory list that kept a withdrawn name because the file was generated before the withdrawal would be the one lie this system must never be able to tell.
