import { countsSentence, deliverableCopy } from "./copy.ts";
import { interFontFace } from "./font.ts";
import type { DeliverableView } from "./view.ts";

/**
 * `specs/screens/deliverable.md`. One standalone HTML document with its
 * stylesheet and its typeface inline — the renderer loads it with no
 * network access, so anything it references by URL would simply be missing.
 * The statement's own markup is the same sanitized HTML the document screen
 * receives (`specs/architecture.md` § API server); everything around it is
 * built here and escaped here.
 */

const DEFAULT_ACCENT = "#2457f5";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/**
 * A site's `accent` reaches a stylesheet, so it is checked rather than
 * trusted: anything that is not a plain hex color falls back to the
 * project's own accent instead of being written into CSS.
 */
function safeAccent(accent: string | undefined): string {
  return accent && /^#[0-9a-f]{3,8}$/iu.test(accent) ? accent : DEFAULT_ACCENT;
}

export function renderDeliverableHtml(view: DeliverableView): string {
  const accent = safeAccent(view.accent);
  const head = `<meta charset="utf-8"><title>${escapeHtml(view.title)}</title><style>${styles(accent)}</style>`;

  return `<!doctype html>
<html lang="en"><head>${head}</head>
<body class="${view.draft ? "is-draft" : "is-clean"}">
${view.draft ? `<div class="watermark" aria-hidden="true">${deliverableCopy.watermark}</div>` : ""}
<p class="site">${escapeHtml(view.siteName)}</p>
${titleBlock(view)}
<section class="statement">${view.bodyHtml}</section>
${signatoriesSection(view)}
</body></html>`;
}

function titleBlock(view: DeliverableView): string {
  const addressed =
    view.addressedTo.length > 0
      ? `<p class="addressed">${escapeHtml(deliverableCopy.addressedTo(view.addressedTo))}</p>`
      : "";
  const meta = deliverableCopy.meta(view.versionNumber, view.versionDate, view.final);
  const draftNote = view.draft
    ? `<p class="draft-note">${escapeHtml(deliverableCopy.draftNote(view.versionNumber))}</p>`
    : "";
  return `<header class="title-block">${addressed}<h1>${escapeHtml(view.title)}</h1><p class="meta">${escapeHtml(meta)}</p>${draftNote}</header>`;
}

/**
 * `specs/screens/deliverable.md` § Display Rules 4. `show_signatories =
 * none` prints no section and no heading — not an empty one, which would
 * itself disclose that the setting is in force.
 */
function signatoriesSection(view: DeliverableView): string {
  const summary = view.signatories;
  if (!summary) return "";

  const parts: string[] = [
    `<div class="sig-head"><h2>${deliverableCopy.signatories.heading}</h2>`,
    `<p class="counts">${escapeHtml(countsSentence(summary))}</p></div>`,
  ];

  const list = summary.list;
  if (list) {
    const organizations = list.filter((item) => item.capacity === "official");
    const individuals = list.filter((item) => item.capacity !== "official");

    if (organizations.length === 0 && individuals.length === 0 && summary.unlisted === 0) {
      parts.push(`<p class="empty">${deliverableCopy.signatories.none}</p>`);
    }
    if (organizations.length > 0) {
      parts.push(`<h3>${deliverableCopy.signatories.organizations}</h3><ul class="orgs">`);
      for (const item of organizations) {
        const person = [item.display_name, item.title].filter(Boolean).join(", ");
        parts.push(
          `<li><span class="org">${escapeHtml(item.org ?? "")}</span> — ${escapeHtml(person)}</li>`,
        );
      }
      parts.push("</ul>");
    }
    if (individuals.length > 0) {
      parts.push(`<h3>${deliverableCopy.signatories.individuals}</h3><ul class="people">`);
      for (const item of individuals) {
        const line = [item.display_name, item.descriptor].filter(Boolean).join(", ");
        parts.push(`<li>${escapeHtml(line)}</li>`);
      }
      parts.push("</ul>");
    }
  }

  return `<section class="signatories">${parts.join("")}</section>`;
}

/**
 * The print stylesheet. Sized in points against the page box rather than in
 * pixels against a viewport, so the same sheet reads correctly on Letter
 * and on A4 (`specs/screens/deliverable.md` § Design) — the page box is the
 * only thing that differs, and nothing here is positioned against its
 * width.
 */
function styles(accent: string): string {
  return `${interFontFace()}
:root {
  --ink: #0f172a;
  --muted: #5b6472;
  --rule: #d8dee6;
  --accent: ${accent};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  color: var(--ink);
  font-family: "Inter Variable", Inter, "Helvetica Neue", Arial, "Liberation Sans", sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
p { orphans: 2; widows: 2; }

/* Repeated on every printed page: Chromium re-paints a fixed element per
   page, which is what makes one element a watermark rather than a mark on
   the first sheet (specs/screens/deliverable.md § Draft and clean). */
.watermark {
  position: fixed;
  top: 40%;
  left: 0;
  right: 0;
  z-index: 0;
  text-align: center;
  font-size: 92pt;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: rgba(15, 23, 42, 0.07);
  transform: rotate(-28deg);
  pointer-events: none;
}
body > *:not(.watermark) { position: relative; z-index: 1; }

.site {
  margin: 0 0 14pt;
  font-size: 8.5pt;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.title-block {
  border-bottom: 1.5pt solid var(--accent);
  padding-bottom: 10pt;
  margin-bottom: 18pt;
  break-after: avoid;
}
.title-block .addressed { margin: 0 0 6pt; font-size: 10.5pt; color: var(--muted); }
.title-block h1 {
  margin: 0;
  font-size: 21pt;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.015em;
}
.title-block .meta { margin: 7pt 0 0; font-size: 9.5pt; color: var(--muted); }
.title-block .draft-note {
  margin: 7pt 0 0;
  font-size: 9.5pt;
  font-weight: 600;
  color: var(--ink);
}

.statement { font-size: 11pt; line-height: 1.6; }
.statement h1, .statement h2, .statement h3, .statement h4 {
  font-weight: 650;
  line-height: 1.3;
  margin: 16pt 0 5pt;
  break-after: avoid;
}
.statement h1 { font-size: 15pt; }
.statement h2 { font-size: 13pt; }
.statement h3 { font-size: 11.5pt; }
.statement h4 { font-size: 11pt; }
.statement p { margin: 0 0 9pt; }
.statement ul, .statement ol { margin: 0 0 9pt; padding-left: 16pt; }
.statement li { margin: 0 0 3pt; }
.statement li > ul, .statement li > ol { margin-top: 3pt; }
.statement blockquote {
  margin: 0 0 9pt;
  padding-left: 10pt;
  border-left: 2pt solid var(--rule);
  color: var(--muted);
}
.statement a { color: var(--ink); text-decoration: underline; }

/* A section break, not a divider: a short centered hairline with air around
   it (specs/screens/document.md § Design "Section break"). */
.statement hr {
  border: 0;
  height: 0;
  border-top: 0.75pt solid var(--rule);
  width: 16%;
  margin: 16pt auto;
}

/* The four block classes (specs/behaviors/versioning.md § Block classes). */
.statement .lede {
  font-size: 12.5pt;
  line-height: 1.5;
  margin-bottom: 11pt;
}
.statement .callout {
  border: 0.75pt solid var(--rule);
  border-left: 2.5pt solid var(--accent);
  background: #f7f9fc;
  padding: 9pt 11pt;
  margin: 0 0 11pt;
  break-inside: avoid;
}
.statement .callout > *:last-child { margin-bottom: 0; }
.statement .small { font-size: 9pt; color: var(--muted); }
.statement .center { text-align: center; }

/* Citation superscripts and the appended Sources list
   (specs/screens/deliverable.md § Display Rules 3). The superscript is set
   with an explicit line-height so a numbered paragraph keeps the leading of
   an unnumbered one. */
.statement sup.citation-ref {
  font-size: 7pt;
  line-height: 0;
  vertical-align: super;
  font-weight: 650;
}
.statement sup.citation-ref a { color: var(--accent); text-decoration: none; }
.statement .doc-sources {
  margin-top: 18pt;
  border-top: 0.75pt solid var(--rule);
  padding-top: 10pt;
  font-size: 9pt;
  line-height: 1.45;
}
.statement .doc-sources h2 {
  margin: 0 0 6pt;
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}
.statement .doc-sources ol { margin: 0; padding-left: 14pt; }
.statement .doc-sources li { margin: 0 0 3pt; break-inside: avoid; }
/* A printed address is only useful if all of it is on the page. */
.statement .doc-sources a {
  color: var(--ink);
  text-decoration: none;
  word-break: break-all;
}
/* The return arrows are for a screen; on paper they are noise. */
.statement .doc-sources .source-backref { display: none; }
.statement code, .statement pre {
  font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 9.5pt;
}
.statement pre { white-space: pre-wrap; word-wrap: break-word; }
/* A wide table shrinks to the measure rather than clipping or pushing the
   page sideways (specs/screens/deliverable.md § Display Rules 3). */
.statement table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin: 0 0 12pt;
  font-size: 9.5pt;
}
.statement th, .statement td {
  border: 0.75pt solid var(--rule);
  padding: 4pt 6pt;
  text-align: left;
  vertical-align: top;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.statement th { font-weight: 650; background: #f4f6f8; }
.statement img { max-width: 100%; }

.signatories { margin-top: 22pt; border-top: 1.5pt solid var(--accent); padding-top: 12pt; }
.sig-head { break-inside: avoid; break-after: avoid; }
.signatories h2 { margin: 0; font-size: 14pt; font-weight: 700; }
.signatories .counts { margin: 5pt 0 0; font-size: 10.5pt; }
.signatories .empty { margin: 8pt 0 0; color: var(--muted); }
.signatories h3 {
  margin: 14pt 0 5pt;
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  break-after: avoid;
}
.signatories ul { margin: 0; padding: 0; list-style: none; }
.signatories li { margin: 0 0 4pt; break-inside: avoid; font-size: 10.5pt; }
.signatories .org { font-weight: 650; color: var(--accent); }`;
}
