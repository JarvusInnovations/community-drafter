export interface Anchor {
  /** Version the comment was written against. */
  version: number;
  /** That version's commit, for robustness if history is ever re-indexed. */
  commit: string;
  /** `data-block` id in that version's render. */
  block: string;
  /** Nearest ancestor heading text by level, shallow to deep. */
  heading_path: string[];
  /** The selected text, 3–1,000 characters. */
  quote: string;
  /** Up to 40 characters of context before the quote; empty at block start. */
  prefix: string;
  /** Up to 40 characters of context after the quote; empty at block end. */
  suffix: string;
  /** Character offset of `quote` within the block's text. */
  start: number;
  /** Set when the original selection crossed a block boundary and was truncated to `block`'s end. */
  spans_blocks?: boolean;
}

export type PlacementConfidence = "exact" | "block" | "quote";

export interface AnchorPlacement {
  blockId: string;
  start: number;
  length: number;
  confidence: PlacementConfidence;
}
