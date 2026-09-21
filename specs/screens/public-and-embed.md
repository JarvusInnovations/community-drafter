# Screen: Public Views and Embeds

What someone sees who has the document's public link rather than a personal one, and the pieces an organization's own site can embed.

## Routes

| Route | Purpose | Framing |
| --- | --- | --- |
| `/d/<slug>` | public read view | not frameable |
| `/d/<slug>/history`, `/d/<slug>/history/compare` | public history and comparison | not frameable |
| `/d/<slug>/embed` | the document text and version label only, minimal chrome | frameable by any origin |
| `/d/<slug>/signatories` | signatory list and counts, minimal chrome | frameable |
| `/d/<slug>/signatories.json` | counts and the listed signatories | CORS `*` |
| `/d/<slug>/widget.js` | a tiny script that renders counts + "signed by" into a host element | CORS `*` |

All 404 when `public_access = none`, `state = draft`, or the slug is unknown, with the same body.

Every route here lives on the document's **site** hostname (`behaviors/sites.md`). Asked for on another site's host, each redirects to the canonical host with its path and query intact — including the embed, JSON and widget routes, so a host page that embeds the canonical address never sees a redirect. An unknown slug is the same 404 on every host.

## Data Requirements

Document (title, phase, deadlines, `show_signatories`, `reply_to`), the document's site (name, `logo_url`, `accent`), current version, signatory counts and list (listed, approved, unrevoked only), version list.

## Display Rules

**Public read view**: the document screen layout without the status card and identity line. In its place, a card: "Want to add your name? This document is open to invited signers. Ask the team for your personal link: *reply_to*." **[phase 2]** when `public_access = participate`, the card becomes "Sign or comment: enter your email and we'll send you your own link" with name and email fields, then a "check your email" state.

**Site identity**: the top bar names the document's site — its `logo_url` image when set, otherwise its `name` as text, with the name as the accessible name either way — and the accent token follows the site's `accent` when it sets one. Nothing on the page names, links to or hints at the platform or any other site.

**Embed**: title, version label (with "see what changed" linking to the public history in a new tab), the document text, a footer line "Read the full page" linking to `/d/<slug>` in a new tab. No signatory list, no clock (the host page owns that context). Height reported to the parent via `postMessage` so hosts can size the frame.

**Signatories page/fragment**: the counts line, then organizations, then individuals, per `behaviors/signatures.md`; "and N others who asked not to be listed"; last updated time. Honors `show_signatories`. Minimal chrome does not mean unstyled: it carries the design's card, type and signatory chips (`screens/document.md` § Design, "Signatories card") without the frame, so it reads as part of the same statement whether it is opened on its own or framed on the organization's site.

**Widget**: renders into `<div data-drafter-doc="<slug>"></div>` the counts sentence and, optionally by attribute, the list; polls every 5 minutes; degrades to nothing if the JSON is unavailable. Under 3 KB.

**Browser tab**: every public page's document title names the document and then the instance — "Charter of the Save the Academy Coalition · Save the Academy Coalition Drafter" — so a shared link is identifiable in a tab strip, a bookmark and a history entry. The participant and admin document screens do the same with their own document.

**Personal links are never frameable** and never referenced from any public surface.

## Share Preview

Every HTML page this instance serves declares Open Graph and Twitter card metadata in its head, because a link to one of these pages is forwarded far more often than it is typed: into a group chat, a mailing list, a board packet. What the metadata may say depends entirely on who the link is for.

**A public document page** (`/d/<slug>` and the routes under it, when the document would render rather than 404) declares:

- title: the document's title, and `og:site_name` the instance name;
- description: one line — the current version's `summary`; failing that, the first sentence of the current version's text; failing that, a generic line naming the instance;
- `og:url` and the canonical link: `<instance>/d/<slug>`, whichever of the document's public routes was requested;
- `og:type`: `article`;
- image: a generic instance card, the same static image for every document. Nothing about a document is rendered into an image — the title and the one-line description are already in the preview's text, and a per-document image would put an image renderer in the path of an anonymous request.

**Every other page** — an unknown slug, a document with `public_access = none` or `state = draft`, every `/i/<token>/…` personal-link page, every `/admin` page, and the instance root — declares the generic instance tags and nothing else: the instance name as the title, a generic one-line description, the instance's own URL, `og:type=website`, and the same instance card. The tags for a private slug are byte-identical to the tags for a slug that was never created. Personal-link and admin pages additionally declare `noindex`: they are nobody's to index, and the one that carries a credential in its URL must never end up in a crawler's corpus.

## Actions

Read; history; **[phase 2]** request a personal link.

## Principles

**Inherited**
- [Say exactly who signed](../principles.md#say-exactly-who-signed): every public number comes from the same query the participant page uses.
- [One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby): nothing here links to any other document, to the site root, or to any other site.
- [The link is the identity](../principles.md#the-link-is-the-identity): the public view never offers a way to act as someone; **[phase 2]** it offers a way to get your own link.

**Local**
- **A share preview never confirms a document exists.** A preview is read by machines, before and without any human clicking: paste a URL into a chat and a scraper fetches it, unauthenticated, and shows the result to everyone in the room. So the metadata is held to the same standard as the response body — a private slug, a draft, and a slug that was never created all preview identically, and a personal link previews as the instance and never as the document it opens. Where a richer preview and this rule conflict, the preview loses: the cost of a plain card is a duller paste, and the cost of a leak is a document's title and existence disclosed to a room nobody chose.

Also governed by `behaviors/sites.md` § Principles, "A site is the only identity a participant ever sees": the name, logo, accent, reply-to address and hostname on this page all belong to the document's site.
