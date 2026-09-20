import { textSimilarity } from "./similarity.ts";

/** Below this, two differently-id'd units are treated as unrelated (one removed, one added). */
export const SIMILARITY_THRESHOLD = 0.5;

/** The minimum an alignable unit carries: a stable id and normalized text. */
export interface Alignable {
  id: string;
  text: string;
}

export type AlignedOp<T extends Alignable = Alignable> =
  | { type: "matched"; from: T; to: T }
  | { type: "removed"; from: T }
  | { type: "added"; to: T };

function unitsMatch(a: Alignable, b: Alignable): boolean {
  if (a.id === b.id) return true;
  return textSimilarity(a.text, b.text) >= SIMILARITY_THRESHOLD;
}

/**
 * Longest-common-subsequence alignment of two unit sequences per
 * `specs/behaviors/versioning.md` § Diff steps 1-2: match by id first (an
 * exact-text hash never differs), else by textual similarity, using
 * order-preserving LCS so a unit moved far enough to break the surrounding
 * order comes out as a removal + addition rather than a mismatched pair.
 *
 * Generic over the unit so it serves both single blocks and whole tables
 * (`specs/behaviors/versioning.md` § Diff step 1: a table is one unit).
 */
export function alignBlocks<T extends Alignable>(fromUnits: T[], toUnits: T[]): AlignedOp<T>[] {
  const n = fromUnits.length;
  const m = toUnits.length;

  // dp[i][j] = length of the best alignment of fromUnits[i:] and toUnits[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const from = fromUnits[i];
      const to = toUnits[j];
      if (from && to && unitsMatch(from, to)) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]?.[j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }

  const ops: AlignedOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const from = fromUnits[i]!;
    const to = toUnits[j]!;
    if (unitsMatch(from, to)) {
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
    ops.push({ type: "removed", from: fromUnits[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "added", to: toUnits[j]! });
    j += 1;
  }

  return ops;
}
