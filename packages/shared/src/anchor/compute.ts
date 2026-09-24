import type { Block } from "../render/types.ts";
import type { Anchor } from "./types.ts";

/** Max prefix/suffix context captured either side of a quote (`specs/behaviors/inline-comments.md` § Anchor shape). */
export const CONTEXT_WINDOW = 40;

export interface ComputeAnchorInput {
  /** Blocks of the version the comment is being written against. */
  blocks: Block[];
  blockId: string;
  /** Character offset of the selection start within the block's text. */
  start: number;
  /** Selection length in characters, as measured in the block containing `start`. */
  length: number;
  version: number;
  commit: string;
}

/**
 * Builds an anchor from a selection expressed as `(blockId, start, length)`
 * against `blocks` — the shared shape used by both DOM-based capture
 * (`anchorFromSelection` in `anchor/dom.ts`) and text-based tests.
 *
 * A selection whose `start + length` runs past the block's own text is
 * truncated at the block's end and flagged `spans_blocks: true`, per
 * `specs/behaviors/inline-comments.md` § Anchor shape.
 */
export function computeAnchor(input: ComputeAnchorInput): Anchor {
  const { blocks, blockId, start, length, version, commit } = input;
  const block = blocks.find((candidate) => candidate.id === blockId);
  if (!block) {
    throw new Error(`computeAnchor: no block with id "${blockId}"`);
  }

  const text = block.text;
  const clampedStart = Math.max(0, Math.min(start, text.length));
  const naturalEnd = clampedStart + Math.max(0, length);
  const spansBlocks = naturalEnd > text.length;
  const end = spansBlocks ? text.length : naturalEnd;

  const quote = text.slice(clampedStart, end);
  const prefix = text.slice(Math.max(0, clampedStart - CONTEXT_WINDOW), clampedStart);
  const suffix = spansBlocks ? "" : text.slice(end, Math.min(text.length, end + CONTEXT_WINDOW));

  const anchor: Anchor = {
    version,
    commit,
    block: block.id,
    heading_path: block.headingPath,
    quote,
    prefix,
    suffix,
    start: clampedStart,
  };
  if (spansBlocks) anchor.spans_blocks = true;
  return anchor;
}
