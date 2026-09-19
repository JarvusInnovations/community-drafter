import { diffWordsWithSpace } from "diff";

import type { Block } from "../render/types.ts";
import { alignBlocks } from "./align.ts";
import { escapeHtml, wrapBlockHtml } from "./html.ts";

export type { AlignedOp } from "./align.ts";
export { SIMILARITY_THRESHOLD } from "./align.ts";
export { textSimilarity } from "./similarity.ts";

export type BlockDiffStatus = "same" | "changed" | "added" | "removed";

export interface BlockDiff {
  status: BlockDiffStatus;
  id: string;
  html: string;
  /**
   * Text is unchanged but presentation differs (heading level, list marker):
   * a formatting-only change per `specs/behaviors/versioning.md` § Diff step
   * 5. UI shows a marginal note, not a redline.
   */
  format_only?: boolean;
}

export interface DiffSummary {
  changed: number;
  added: number;
  removed: number;
}

export interface DiffResult {
  summary: DiffSummary;
  blocks: BlockDiff[];
}

function isFormatChange(from: Block, to: Block): boolean {
  return from.tag !== to.tag || from.ordered !== to.ordered;
}

function redlineHtml(from: Block, to: Block): string {
  const parts = diffWordsWithSpace(from.text, to.text);
  const inner = parts
    .map((part) => {
      const escaped = escapeHtml(part.value);
      if (part.added) return `<ins>${escaped}</ins>`;
      if (part.removed) return `<del>${escaped}</del>`;
      return escaped;
    })
    .join("");
  return wrapBlockHtml(to.tag, to.id, inner);
}

/**
 * Block-aligned redline between two versions' rendered blocks, per
 * `specs/behaviors/versioning.md` § Diff. Browser-safe: operates on already
 * rendered `Block[]`, not markdown (no `unified` dependency).
 */
export function diffVersions(fromBlocks: Block[], toBlocks: Block[]): DiffResult {
  const ops = alignBlocks(fromBlocks, toBlocks);

  const summary: DiffSummary = { changed: 0, added: 0, removed: 0 };
  const blocks: BlockDiff[] = [];

  for (const op of ops) {
    if (op.type === "removed") {
      summary.removed += 1;
      blocks.push({ status: "removed", id: op.from.id, html: op.from.html });
      continue;
    }
    if (op.type === "added") {
      summary.added += 1;
      blocks.push({ status: "added", id: op.to.id, html: op.to.html });
      continue;
    }

    const { from, to } = op;
    const textChanged = from.text !== to.text;
    if (!textChanged && !isFormatChange(from, to)) {
      blocks.push({ status: "same", id: to.id, html: to.html });
      continue;
    }
    if (!textChanged) {
      // Same text, different presentation: flag, don't redline.
      summary.changed += 1;
      blocks.push({ status: "changed", id: to.id, html: to.html, format_only: true });
      continue;
    }
    summary.changed += 1;
    blocks.push({ status: "changed", id: to.id, html: redlineHtml(from, to) });
  }

  return { summary, blocks };
}
