/**
 * Browser-only DOM helpers for comment capture and highlight placement
 * (`specs/behaviors/inline-comments.md` § Capture, § Re-anchoring on
 * display). Split out from `anchor/index.ts` so the pure text-based
 * `computeAnchor`/`placeAnchor` stay importable (and testable) under Bun
 * with no DOM present. This module has no top-level DOM access — only
 * function bodies touch `document`/`Node`/etc. — so importing it alone is
 * still safe under Bun; calling its functions is not.
 *
 * Offsets here are always in the **normalized** coordinate space of a
 * block's `text` (`render/block-ids.ts`), not in raw DOM characters: that is
 * the space `computeAnchor`/`placeAnchor` work in, and the two differ
 * wherever rendered markdown puts whitespace inside a block (a loose list
 * item is `<li>\n<p>…</p>\n</li>`).
 */
import { type NormalizedOffsets, normalizeOffsets } from "../render/normalize.ts";

export interface SelectionInfo {
  blockId: string;
  start: number;
  length: number;
  spansBlocks: boolean;
}

/** Tags whose contents get their own blocks (mirrors the server's `extractBlockText`). */
const CONTAINER_TAGS = new Set(["UL", "OL", "TABLE", "BLOCKQUOTE"]);

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

interface BlockTextMap {
  /** The block's own text nodes in document order, each with its raw start offset. */
  nodes: Array<{ node: Text; start: number }>;
  raw: string;
  offsets: NormalizedOffsets;
}

/**
 * The block's own text — stopping at nested container tags, exactly as the
 * server's `extractBlockText` does — together with the raw↔normalized index
 * maps and the text nodes it came from.
 */
function blockTextMap(blockEl: Element): BlockTextMap {
  const nodes: Array<{ node: Text; start: number }> = [];
  let raw = "";

  const walk = (parent: Node): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child as Text;
        nodes.push({ node: text, start: raw.length });
        raw += text.data;
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (CONTAINER_TAGS.has((child as Element).tagName)) continue;
        walk(child);
      }
    }
  };
  walk(blockEl);

  return { nodes, raw, offsets: normalizeOffsets(raw) };
}

/** Raw character offset of `(container, containerOffset)` within the block's own text. */
function rawOffsetWithin(map: BlockTextMap, container: Node, containerOffset: number): number {
  for (const entry of map.nodes) {
    if (entry.node === container) return entry.start + containerOffset;
  }
  // `container` was an element (its offset is a child index) or belongs to a
  // nested container block: best-effort fallback at the block's end.
  return map.raw.length;
}

/** The same position expressed in the block's normalized `text`. */
function normalizedOffsetWithin(
  map: BlockTextMap,
  blockEl: Element,
  container: Node,
  containerOffset: number,
): number {
  if (container === blockEl && containerOffset === 0) return 0;
  const raw = rawOffsetWithin(map, container, containerOffset);
  const clamped = Math.max(0, Math.min(raw, map.raw.length));
  return map.offsets.rawToNormalized[clamped] ?? map.offsets.text.length;
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

  const map = blockTextMap(startEl);
  const start = normalizedOffsetWithin(map, startEl, range.startContainer, range.startOffset);
  const endEl = closestBlock(range.endContainer, root as unknown as Node);

  if (endEl === startEl) {
    const end = normalizedOffsetWithin(map, startEl, range.endContainer, range.endOffset);
    return { blockId, start, length: Math.max(0, end - start), spansBlocks: false };
  }

  // Selection crosses a block boundary: truncate at this block's end.
  const length = Math.max(0, map.offsets.text.length - start);
  return { blockId, start, length, spansBlocks: true };
}

export interface AnchorPlacementLike {
  blockId: string;
  start: number;
  length: number;
}

/** The text node and offset a raw block offset falls in; `preferNext` breaks boundary ties forward. */
function locate(
  map: BlockTextMap,
  rawOffset: number,
  preferNext: boolean,
): { node: Text; offset: number } | null {
  for (const entry of map.nodes) {
    const end = entry.start + entry.node.data.length;
    if (preferNext ? rawOffset < end : rawOffset <= end) {
      return { node: entry.node, offset: Math.max(0, rawOffset - entry.start) };
    }
  }
  const last = map.nodes[map.nodes.length - 1];
  return last ? { node: last.node, offset: last.node.data.length } : null;
}

/**
 * Builds a `Range` for a placed anchor by walking `root` for the element
 * carrying `data-block="<placement.blockId>"`, then mapping the placement's
 * normalized offsets back onto that block's text nodes, per § Re-anchoring
 * on display.
 */
export function rangeFromAnchorPlacement(
  root: ParentNode,
  placement: AnchorPlacementLike,
): Range | null {
  const selector = `[data-block="${placement.blockId}"]`;
  const blockEl = root.querySelector(selector);
  if (!blockEl) return null;

  const map = blockTextMap(blockEl);
  const text = map.offsets.text;
  const startNormalized = Math.max(0, Math.min(placement.start, text.length));
  const endNormalized = Math.max(
    startNormalized,
    Math.min(placement.start + placement.length, text.length),
  );

  const rawStart = map.offsets.normalizedToRaw[startNormalized] ?? map.raw.length;
  const rawEnd = map.offsets.normalizedToRaw[endNormalized] ?? map.raw.length;

  const start = locate(map, rawStart, true);
  const end = locate(map, rawEnd, false);
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}
