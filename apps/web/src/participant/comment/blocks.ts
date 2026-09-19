import { type Block, type BlockTag, normalizeText } from "@community-drafter/shared/browser";

/**
 * Reconstructs `Block[]`-shaped data from the *live rendered DOM* so
 * `computeAnchor`/`placeAnchor` (`@community-drafter/shared/browser`, which
 * both expect `Block[]`) can run entirely client-side. The server-only
 * render pipeline (`packages/shared/src/render/block-ids.ts`) already baked
 * `data-block` ids into `version.html` before it ever reached the browser
 * (`specs/behaviors/inline-comments.md` § Block identity); this only
 * re-derives the `text`/`headingPath`/`tag` fields those functions need, by
 * walking the same document in the same order the server did.
 */
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const CONTAINER_TAGS = new Set(["UL", "OL", "TABLE", "BLOCKQUOTE"]);

/** Concatenates `el`'s own text, stopping at nested container tags (mirrors the server's `extractBlockText`). */
function extractBlockText(el: Element): string {
  let out = "";
  const walk = (node: ChildNode): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node as Text).data;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (CONTAINER_TAGS.has(element.tagName)) {
        return;
      }
      element.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
  return out;
}

export function blocksFromDom(root: ParentNode): Block[] {
  const blocks: Block[] = [];
  const headingStack: (string | undefined)[] = Array.from({ length: 6 });
  const currentHeadingPath = (): string[] =>
    headingStack.filter((value): value is string => Boolean(value));

  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;

  while (node) {
    const tag = node.tagName;

    if (HEADING_TAGS.has(tag)) {
      const level = Number(tag.slice(1));
      const blockId = node.getAttribute("data-block");
      if (blockId) {
        blocks.push({
          id: blockId,
          text: normalizeText(extractBlockText(node)),
          headingPath: currentHeadingPath(),
          tag: tag.toLowerCase() as BlockTag,
          html: node.outerHTML,
        });
      }
      const headingText = normalizeText(extractBlockText(node));
      headingStack[level - 1] = headingText;
      for (let deeper = level; deeper < 6; deeper += 1) {
        headingStack[deeper] = undefined;
      }
    } else {
      const blockId = node.getAttribute("data-block");
      if (blockId) {
        const parentTag = node.parentElement?.tagName;
        const ordered = tag === "LI" ? parentTag === "OL" : undefined;
        blocks.push({
          id: blockId,
          text: normalizeText(extractBlockText(node)),
          headingPath: currentHeadingPath(),
          tag: tag.toLowerCase() as BlockTag,
          html: node.outerHTML,
          ...(ordered === undefined ? {} : { ordered }),
        });
      }
    }

    node = walker.nextNode() as Element | null;
  }

  return blocks;
}
