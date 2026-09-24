import type { Block, BlockContainer, CodeBlock } from "../render/types.ts";

/**
 * The kinds of thing a reader would name when asked what changed
 * (`specs/screens/version-history.md` § Principles, Local: "Count and show
 * changes the way a reader would name them").
 */
export type DiffUnitKind = "paragraph" | "heading" | "list item" | "table" | "code block";

/** A single block compared on its own. */
export interface BlockUnit {
  type: "block";
  id: string;
  text: string;
  kind: DiffUnitKind;
  block: Block;
}

/** A whole table compared as one unit, with its cells in document order. */
export interface TableUnit {
  type: "table";
  id: string;
  text: string;
  kind: "table";
  container: BlockContainer;
  cells: Block[];
}

/** A whole fenced code block, compared on its exact text. */
export interface CodeUnit {
  type: "code";
  id: string;
  text: string;
  kind: "code block";
  code: CodeBlock;
}

export type DiffUnit = BlockUnit | TableUnit | CodeUnit;

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function kindForBlock(block: Block): DiffUnitKind {
  if (block.tag === "li") return "list item";
  if (HEADING_TAGS.has(block.tag)) return "heading";
  return "paragraph";
}

/**
 * Collapses a version's blocks into the units the comparison aligns
 * (`specs/behaviors/versioning.md` § Diff step 1): every block stands alone
 * except a table's cells, which fold into the one table unit they share, and
 * each code block slots in whole at the position it was rendered at.
 */
export function toUnits(blocks: Block[], code: CodeBlock[] = []): DiffUnit[] {
  const units: DiffUnit[] = [];
  let nextCode = 0;
  const flushCode = (upTo: number): void => {
    while (nextCode < code.length && code[nextCode]!.position <= upTo) {
      const entry = code[nextCode]!;
      units.push({ type: "code", id: entry.id, text: entry.text, kind: "code block", code: entry });
      nextCode += 1;
    }
  };

  for (const [index, block] of blocks.entries()) {
    flushCode(index);
    const container = block.container;
    if (!container) {
      units.push({
        type: "block",
        id: block.id,
        text: block.text,
        kind: kindForBlock(block),
        block,
      });
      continue;
    }

    const open = units.at(-1);
    if (open?.type === "table" && open.container.id === container.id) {
      open.cells.push(block);
      continue;
    }

    units.push({
      type: "table",
      id: container.id,
      text: container.text,
      kind: "table",
      container,
      cells: [block],
    });
  }

  flushCode(Number.POSITIVE_INFINITY);
  return units;
}
