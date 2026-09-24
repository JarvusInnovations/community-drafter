/**
 * Shared block types produced by the render pipeline and consumed by diff and
 * anchor placement. Kept dependency-free so both the server-only render
 * pipeline and the browser-safe diff/anchor modules can share one shape.
 */

/** HTML tag names that can carry a `data-block` id. */
export type BlockTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "td" | "th";

/**
 * The comparison unit a block belongs to when the block is not one on its
 * own. Table cells carry their table, because a table is compared as a whole
 * (`specs/behaviors/versioning.md` § Diff steps 1 and 4) — a cell is never
 * aligned against a paragraph or against a cell of a different table.
 */
export interface BlockContainer {
  kind: "table";
  /** `t-<8 hex>` (with an `-2`, `-3`, … ordinal suffix on collision). */
  id: string;
  /** Normalized text of every cell, in document order, joined by spaces. */
  text: string;
  /** Serialized HTML for the whole container, cell `data-block` ids included. */
  html: string;
  /** Cells per row, in document order: the table's shape. */
  shape: number[];
}

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
  /** For `td`/`th` blocks: the table they are compared as part of. */
  container?: BlockContainer;
}

/**
 * A fenced code block. It is a comparison unit (`specs/behaviors/versioning.md`
 * § Diff step 1) but not a commentable block
 * (`specs/behaviors/inline-comments.md` § Block identity), so it rides beside
 * `blocks` rather than in it: nothing that anchors a comment ever sees one,
 * and no block's id or text depends on it.
 */
export interface CodeBlock {
  /** `c-<8 hex>` (with an `-2`, `-3`, … ordinal suffix on collision), from its own counter. */
  id: string;
  /** The code exactly as written, minus the one trailing newline every fence ends with. */
  text: string;
  /** Serialized HTML for the whole `<pre>`. */
  html: string;
  /** How many commentable blocks precede it in document order: where it sits among `blocks`. */
  position: number;
}

/** What a comparison reads from one rendered version: its blocks and, optionally, its code blocks. */
export interface ComparableVersion {
  blocks: Block[];
  code?: CodeBlock[];
}

/** Options that change presentation only (`specs/behaviors/versioning.md` § Rendering). */
export interface RenderOptions {
  /**
   * How inline citation links are presented (§ Citations). `links` is the
   * default: links render as links and nothing is appended. Whatever the
   * mode, the `blocks` below come out identical — block identity is
   * invariant, because a comment must land in the same place however its
   * reader is reading.
   */
  citations?: import("./citations.ts").CitationsMode;
}

export interface RenderResult {
  /** Full sanitized document HTML, with `data-block` ids and heading slugs baked in. */
  html: string;
  blocks: Block[];
  /** Code blocks in document order: compared, never commented on. */
  code: CodeBlock[];
}
