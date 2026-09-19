/**
 * Browser-only DOM helpers for comment capture and highlight placement
 * (`specs/behaviors/inline-comments.md` § Capture, § Re-anchoring on
 * display). Split out from `anchor/index.ts` so the pure text-based
 * `computeAnchor`/`placeAnchor` stay importable (and testable) under Bun
 * with no DOM present. This module has no top-level DOM access — only
 * function bodies touch `document`/`Node`/etc. — so importing it alone is
 * still safe under Bun; calling its functions is not.
 */

export interface SelectionInfo {
  blockId: string;
  start: number;
  length: number;
  spansBlocks: boolean;
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

/** Nearest ancestor (inclusive) of `node` carrying `data-block`, not walking past `root`. */
function closestBlock(node: Node, root: Node): Element | null {
  let current: Node | null = isElement(node) ? node : node.parentElement;
  while (current && current !== root) {
    if (isElement(current) && current.hasAttribute("data-block")) return current;
    current = current.parentNode;
  }
  return null;
}

/** Concatenates a block element's text nodes in document order (mirrors `render/block-ids.ts`' text extraction). */
function blockText(blockEl: Element): string {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let text = "";
  let node = walker.nextNode();
  while (node) {
    text += (node as Text).data;
    node = walker.nextNode();
  }
  return text;
}

/** Character offset of `(container, containerOffset)` within `blockEl`'s text, per `blockText`'s walk order. */
function offsetWithinBlock(blockEl: Element, container: Node, containerOffset: number): number {
  if (container === blockEl && containerOffset === 0) return 0;

  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === container) return total + containerOffset;
    total += (node as Text).data.length;
    node = walker.nextNode();
  }
  // `container` was an element (offset is a child index), or wasn't found: best-effort fallback.
  return total;
}

/**
 * Computes `{ blockId, start, length }` from a live selection `range`,
 * per § Capture: nearest ancestor `data-block`, text-node walk for the
 * offset, and truncation at the block's end when the selection spans
 * blocks (flagged `spansBlocks`).
 */
export function anchorFromSelection(range: Range, root: ParentNode): SelectionInfo | null {
  const startEl = closestBlock(range.startContainer, root as unknown as Node);
  if (!startEl) return null;

  const blockId = startEl.getAttribute("data-block");
  if (!blockId) return null;

  const start = offsetWithinBlock(startEl, range.startContainer, range.startOffset);
  const endEl = closestBlock(range.endContainer, root as unknown as Node);

  if (endEl === startEl) {
    const end = offsetWithinBlock(startEl, range.endContainer, range.endOffset);
    return { blockId, start, length: Math.max(0, end - start), spansBlocks: false };
  }

  // Selection crosses a block boundary: truncate at this block's end.
  const length = Math.max(0, blockText(startEl).length - start);
  return { blockId, start, length, spansBlocks: true };
}

export interface AnchorPlacementLike {
  blockId: string;
  start: number;
  length: number;
}

/**
 * Builds a `Range` for a placed anchor by walking `root` for the element
 * carrying `data-block="<placement.blockId>"`, then walking its text nodes
 * to find the start/end offsets, per § Re-anchoring on display.
 */
export function rangeFromAnchorPlacement(
  root: ParentNode,
  placement: AnchorPlacementLike,
): Range | null {
  const selector = `[data-block="${placement.blockId}"]`;
  const blockEl = root.querySelector(selector);
  if (!blockEl) return null;

  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const len = text.data.length;
    if (!startNode && consumed + len >= placement.start) {
      startNode = text;
      startOffset = placement.start - consumed;
    }
    if (startNode && consumed + len >= placement.start + placement.length) {
      endNode = text;
      endOffset = placement.start + placement.length - consumed;
      break;
    }
    consumed += len;
    node = walker.nextNode();
  }

  if (!startNode) return null;
  if (!endNode) {
    endNode = startNode;
    endOffset = startNode.data.length;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
