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

## Data Requirements

Document (title, phase, deadlines, `show_signatories`, `reply_to`), current version, signatory counts and list (listed, approved, unrevoked only), version list.

## Display Rules

**Public read view**: the document screen layout without the status card and identity line. In its place, a card: "Want to add your name? This document is open to invited signers. Ask the team for your personal link: *reply_to*." **[phase 2]** when `public_access = participate`, the card becomes "Sign or comment: enter your email and we'll send you your own link" with name and email fields, then a "check your email" state.

**Embed**: title, version label (with "see what changed" linking to the public history in a new tab), the document text, a footer line "Read the full page" linking to `/d/<slug>` in a new tab. No signatory list, no clock (the host page owns that context). Height reported to the parent via `postMessage` so hosts can size the frame.

**Signatories page/fragment**: the counts line, then organizations, then individuals, per `behaviors/signatures.md`; "and N others who asked not to be listed"; last updated time. Honors `show_signatories`.

**Widget**: renders into `<div data-drafter-doc="<slug>"></div>` the counts sentence and, optionally by attribute, the list; polls every 5 minutes; degrades to nothing if the JSON is unavailable. Under 3 KB.

**Personal links are never frameable** and never referenced from any public surface.

## Actions

Read; history; **[phase 2]** request a personal link.

## Principles

**Inherited**
- [Say exactly who signed](../principles.md#say-exactly-who-signed): every public number comes from the same query the participant page uses.
- [One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby): nothing here links to any other document or to the instance root.
- [The link is the identity](../principles.md#the-link-is-the-identity): the public view never offers a way to act as someone; **[phase 2]** it offers a way to get your own link.
