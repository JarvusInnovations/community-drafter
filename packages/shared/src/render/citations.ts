import type { Element, ElementContent, Root } from "hast";

/**
 * How the citation links in a document's text are presented
 * (`specs/behaviors/versioning.md` § Citations).
 *
 * - `links` — links render as links, nothing appended. The default
 *   everywhere a reader can click.
 * - `footnotes` — citation text renders plain, followed by a superscript
 *   number, with a **Sources** list appended. For paper.
 * - `hybrid` — the link stays clickable *and* takes the number, with the
 *   Sources list appended. The deliverable's default.
 */
export type CitationsMode = "links" | "footnotes" | "hybrid";

export const CITATION_MODES: readonly CitationsMode[] = ["links", "footnotes", "hybrid"];

export function parseCitationsMode(
  value: string | undefined,
  fallback: CitationsMode = "links",
): CitationsMode {
  return CITATION_MODES.includes(value as CitationsMode) ? (value as CitationsMode) : fallback;
}

/**
 * Heading text for the appended section, and the ids its anchors use. The
 * `doc-` / `src-` prefixes keep them clear of `rehype-slug`'s heading
 * slugs, so a document that already has a "Sources" heading of its own does
 * not collide with this one.
 */
const SOURCES_HEADING = "Sources";
const SOURCES_HEADING_ID = "doc-sources-heading";

/**
 * A text fragment (`#:~:text=…`) names a phrase to highlight inside a
 * document, not a different document, so two links that differ only by one
 * are one source (`specs/behaviors/versioning.md` § Citations). The link's
 * own target keeps the fragment — clicking still jumps to the passage —
 * while the Sources entry shows, and is deduplicated on, the address
 * without it.
 */
export function canonicalCitationUrl(href: string): string {
  const cut = href.indexOf("#:~:text=");
  return cut === -1 ? href : href.slice(0, cut);
}

/**
 * `specs/behaviors/versioning.md` § Citations, "A visible URL is never a
 * citation": when a link's own text is the address, a number would add
 * nothing, so the link keeps its link form in every mode and never reaches
 * Sources. Catches GFM autolinks and a link an author labelled with its own
 * target.
 */
function textIsBareUrl(node: Element, href: string): boolean {
  const text = elementText(node).trim();
  if (text === "") return false;
  if (text === href || text === canonicalCitationUrl(href)) return true;
  return /^(?:https?:\/\/|www\.)\S+$/iu.test(text);
}

function elementText(node: Element | ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  let out = "";
  for (const child of node.children) out += elementText(child);
  return out;
}

function isCitationLink(node: Element): string | undefined {
  if (node.tagName !== "a") return undefined;
  const properties = node.properties ?? {};
  // A real GFM footnote reference and its back-link are markup, not citations.
  if (properties.dataFootnoteRef !== undefined || properties.dataFootnoteBackref !== undefined) {
    return undefined;
  }
  const href = typeof properties.href === "string" ? properties.href : undefined;
  if (!href || !/^https?:\/\//iu.test(href)) return undefined;
  if (textIsBareUrl(node, href)) return undefined;
  return href;
}

interface Source {
  number: number;
  /** The address as it appears in the Sources list: the target minus any text fragment. */
  url: string;
  /** One per place the source is cited, in document order. */
  refIds: string[];
}

function superscript(source: Source, refId: string): Element {
  return {
    type: "element",
    tagName: "sup",
    properties: { className: ["citation-ref"], id: refId },
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: `#src-${source.number}`, "aria-label": `Source ${source.number}` },
        children: [{ type: "text", value: String(source.number) }],
      },
    ],
  };
}

function sourcesSection(sources: Source[]): Element {
  const items: ElementContent[] = sources.map((source) => {
    const children: ElementContent[] = [
      {
        type: "element",
        tagName: "a",
        properties: { href: source.url, className: ["source-url"] },
        children: [{ type: "text", value: source.url }],
      },
    ];
    source.refIds.forEach((refId, index) => {
      children.push(
        { type: "text", value: " " },
        {
          type: "element",
          tagName: "a",
          properties: {
            href: `#${refId}`,
            className: ["source-backref"],
            "aria-label":
              source.refIds.length === 1
                ? `Back to the citation of source ${source.number}`
                : `Back to citation ${index + 1} of source ${source.number}`,
          },
          children: [{ type: "text", value: index === 0 ? "↩" : `↩${index + 1}` }],
        },
      );
    });
    return {
      type: "element",
      tagName: "li",
      properties: { id: `src-${source.number}` },
      children,
    };
  });

  return {
    type: "element",
    tagName: "section",
    properties: { className: ["doc-sources"], "aria-labelledby": SOURCES_HEADING_ID },
    children: [
      {
        type: "element",
        tagName: "h2",
        properties: { id: SOURCES_HEADING_ID },
        children: [{ type: "text", value: SOURCES_HEADING }],
      },
      { type: "element", tagName: "ol", properties: {}, children: items },
    ],
  };
}

/**
 * `rehype-citations`: presents the document's inline citation links in the
 * requested mode (`specs/behaviors/versioning.md` § Citations).
 *
 * **Must run after `rehype-block-ids`.** That is the whole reason block
 * identity can be invariant across modes: the blocks are extracted from the
 * links-mode tree before this plugin touches anything, so the ids, the
 * normalized text and the per-block HTML are the same whichever mode is
 * asked for, and the appended Sources section — added after the extraction
 * — can never become a commentable block.
 *
 * A real GFM footnotes section is skipped whole, so `[^1]` renders in every
 * mode exactly as it does today.
 */
export function rehypeCitations(options: { mode: CitationsMode }) {
  return (tree: Root): void => {
    if (options.mode === "links") return;

    const byUrl = new Map<string, Source>();
    const sources: Source[] = [];

    const walk = (parent: Root | Element): void => {
      for (let index = 0; index < parent.children.length; index += 1) {
        const child = parent.children[index];
        if (child === undefined || child.type !== "element") continue;

        // `specs/behaviors/versioning.md` § Citations: "anything inside a
        // real GFM footnote [is] left exactly as [it is], in every mode."
        if (child.properties?.dataFootnotes !== undefined) continue;

        const href = isCitationLink(child);
        if (href === undefined) {
          walk(child);
          continue;
        }

        const url = canonicalCitationUrl(href);
        let source = byUrl.get(url);
        if (!source) {
          source = { number: sources.length + 1, url, refIds: [] };
          byUrl.set(url, source);
          sources.push(source);
        }
        const refId = `src-ref-${source.number}-${source.refIds.length + 1}`;
        source.refIds.push(refId);

        const marker = superscript(source, refId);
        if (options.mode === "footnotes") {
          // The text renders plain and the number carries the reference.
          parent.children.splice(index, 1, ...child.children, marker);
          index += child.children.length;
        } else {
          parent.children.splice(index + 1, 0, marker);
          index += 1;
        }
      }
    };

    walk(tree);

    if (sources.length > 0) tree.children.push(sourcesSection(sources));
  };
}
