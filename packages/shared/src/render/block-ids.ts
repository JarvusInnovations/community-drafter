import { createHash } from "node:crypto";
import { toHtml } from "hast-util-to-html";
import type { Element, ElementContent, Root } from "hast";
import type { VFile } from "vfile";

import { normalizeText } from "./normalize.ts";
import type { Block, BlockContainer, BlockTag } from "./types.ts";

/**
 * `rehype-block-ids`: assigns `data-block="b-<8 hex>"` to every commentable
 * block (paragraphs, headings, list items, blockquote paragraphs, table
 * cells) per `specs/behaviors/inline-comments.md` § Block identity, and
 * records `{ id, text, headingPath, tag, html, ordered }` for each on
 * `file.data.blocks`.
 *
 * Table cells additionally carry a shared `container` describing the whole
 * table (`specs/behaviors/versioning.md` § Diff step 1: "A table is one unit,
 * not a loose run of cells"), so the diff can align tables against tables.
 *
 * Must run after `rehype-sanitize` (so the attribute it adds is never
 * stripped) and after `rehype-slug` (so heading `id`s are already final).
 */
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const CELL_TAGS = new Set(["td", "th"]);
const CONTAINER_TAGS = new Set(["ul", "ol", "table", "blockquote"]);

interface PendingBlock {
  node: Element;
  tag: BlockTag;
  headingPath: string[];
  ordered?: boolean;
}

interface PendingTable {
  node: Element;
  /** Indexes into `pending` of this table's cells, in document order. */
  cells: number[];
  /** Cells per row, in document order. */
  shape: number[];
}

/** Concatenates this element's own text, stopping at nested container tags (their contents get their own blocks). */
function extractBlockText(node: Element): string {
  let out = "";
  const walk = (n: ElementContent): void => {
    if (n.type === "text") {
      out += n.value;
      return;
    }
    if (n.type === "element") {
      if (CONTAINER_TAGS.has(n.tagName)) return;
      for (const child of n.children) walk(child);
    }
  };
  for (const child of node.children) walk(child);
  return out;
}

export function rehypeBlockIds() {
  return (tree: Root, file: VFile): void => {
    const pending: PendingBlock[] = [];
    const idCounts = new Map<string, number>();
    // Nearest preceding heading text per level (index 0 = h1 .. index 5 = h6).
    const headingStack: Array<string | undefined> = Array.from<string | undefined>({
      length: 6,
    }).fill(undefined);

    const currentHeadingPath = (): string[] =>
      headingStack.filter((entry): entry is string => Boolean(entry));

    const assignId = (
      node: Element,
      tag: BlockTag,
      headingPath: string[],
      ordered?: boolean,
    ): void => {
      const text = normalizeText(extractBlockText(node));
      const hash = createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
      const seen = idCounts.get(hash) ?? 0;
      idCounts.set(hash, seen + 1);
      const id = seen === 0 ? `b-${hash}` : `b-${hash}-${seen + 1}`;
      node.properties = node.properties ?? {};
      node.properties["data-block"] = id;
      pending.push({ node, tag, headingPath, ordered });
    };

    const tables: PendingTable[] = [];
    const tableStack: PendingTable[] = [];

    const walk = (parent: Root | Element, parentTag: string | undefined): void => {
      for (const child of parent.children) {
        if (child.type !== "element") continue;
        const tag = child.tagName;

        if (tag === "table") {
          const table: PendingTable = { node: child, cells: [], shape: [] };
          tables.push(table);
          tableStack.push(table);
        } else if (tag === "tr") {
          tableStack.at(-1)?.shape.push(0);
        }

        if (HEADING_TAGS.has(tag)) {
          const level = Number(tag.slice(1));
          assignId(child, tag as BlockTag, currentHeadingPath());
          const headingText = normalizeText(extractBlockText(child));
          headingStack[level - 1] = headingText;
          for (let deeper = level; deeper < 6; deeper += 1) headingStack[deeper] = undefined;
        } else if (tag === "li") {
          assignId(child, "li", currentHeadingPath(), parentTag === "ol");
        } else if (CELL_TAGS.has(tag)) {
          assignId(child, tag as BlockTag, currentHeadingPath());
          const table = tableStack.at(-1);
          if (table) {
            table.cells.push(pending.length - 1);
            const row = table.shape.length - 1;
            if (row >= 0) table.shape[row] = (table.shape[row] ?? 0) + 1;
          }
        } else if (tag === "p" && parentTag !== "li") {
          // A `p` directly inside a list item belongs to that item's block, not its own.
          assignId(child, "p", currentHeadingPath());
        }

        walk(child, tag);

        if (tag === "table") tableStack.pop();
      }
    };

    walk(tree, undefined);

    // Containers are built after the walk so every descendant already carries
    // its `data-block` id by the time the table is serialized.
    const containerCounts = new Map<string, number>();
    const containerByCell = new Map<number, BlockContainer>();
    for (const table of tables) {
      if (table.cells.length === 0) continue;
      const text = table.cells
        .map((index) => normalizeText(extractBlockText(pending[index]!.node)))
        .join(" ");
      const hash = createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
      const seen = containerCounts.get(hash) ?? 0;
      containerCounts.set(hash, seen + 1);
      const container: BlockContainer = {
        kind: "table",
        id: seen === 0 ? `t-${hash}` : `t-${hash}-${seen + 1}`,
        text,
        html: toHtml(table.node),
        shape: table.shape,
      };
      for (const index of table.cells) containerByCell.set(index, container);
    }

    const blocks: Block[] = pending.map(({ node, tag, headingPath, ordered }, index) => ({
      id: String(node.properties?.["data-block"]),
      text: normalizeText(extractBlockText(node)),
      headingPath,
      tag,
      html: toHtml(node),
      ...(ordered === undefined ? {} : { ordered }),
      ...(containerByCell.has(index) ? { container: containerByCell.get(index)! } : {}),
    }));

    file.data.blocks = blocks;
  };
}

declare module "vfile" {
  interface DataMap {
    blocks: Block[];
  }
}
