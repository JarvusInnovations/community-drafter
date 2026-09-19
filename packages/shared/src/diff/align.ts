import type { Block } from "../render/types.ts";
import { textSimilarity } from "./similarity.ts";

/** Below this, two differently-id'd blocks are treated as unrelated (one removed, one added). */
export const SIMILARITY_THRESHOLD = 0.5;

export type AlignedOp =
  | { type: "matched"; from: Block; to: Block }
  | { type: "removed"; from: Block }
  | { type: "added"; to: Block };

function blocksMatch(a: Block, b: Block): boolean {
  if (a.id === b.id) return true;
  return textSimilarity(a.text, b.text) >= SIMILARITY_THRESHOLD;
}

/**
 * Longest-common-subsequence alignment of two block sequences per
 * `specs/behaviors/versioning.md` § Diff steps 1–2: match by id first (an
 * exact-text hash never differs), else by textual similarity, using
 * order-preserving LCS so a block moved far enough to break the surrounding
 * order comes out as a removal + addition rather than a mismatched pair.
 */
export function alignBlocks(fromBlocks: Block[], toBlocks: Block[]): AlignedOp[] {
  const n = fromBlocks.length;
  const m = toBlocks.length;

  // dp[i][j] = length of the best alignment of fromBlocks[i:] and toBlocks[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const from = fromBlocks[i];
      const to = toBlocks[j];
      if (from && to && blocksMatch(from, to)) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]?.[j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }

  const ops: AlignedOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const from = fromBlocks[i]!;
    const to = toBlocks[j]!;
    if (blocksMatch(from, to)) {
      ops.push({ type: "matched", from, to });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      ops.push({ type: "removed", from });
      i += 1;
    } else {
      ops.push({ type: "added", to });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "removed", from: fromBlocks[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "added", to: toBlocks[j]! });
    j += 1;
  }

  return ops;
}
