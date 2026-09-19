/**
 * Shared block types produced by the render pipeline and consumed by diff and
 * anchor placement. Kept dependency-free so both the server-only render
 * pipeline and the browser-safe diff/anchor modules can share one shape.
 */

/** HTML tag names that can carry a `data-block` id. */
export type BlockTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "td" | "th";

export interface Block {
  /** `b-<8 hex>` (with an `-2`, `-3`, … ordinal suffix on collision). */
  id: string;
  /** Normalized text (NFC, whitespace collapsed, markdown/inline formatting removed). */
  text: string;
  /** Nearest ancestor heading text by level, shallow to deep, above this block. */
  headingPath: string[];
  /** Tag this block rendered as. */
  tag: BlockTag;
  /** Serialized HTML for just this block (its own tag, `data-block` attribute, and content). */
  html: string;
  /** For `li` blocks: whether the enclosing list is ordered (`<ol>`) vs unordered (`<ul>`). */
  ordered?: boolean;
}

export interface RenderResult {
  /** Full sanitized document HTML, with `data-block` ids and heading slugs baked in. */
  html: string;
  blocks: Block[];
}
