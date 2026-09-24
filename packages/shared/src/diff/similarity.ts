import { diffWordsWithSpace } from "diff";

/**
 * Jaccard-like character-overlap ratio between two strings, computed from a
 * word-level diff: `common / (len(a) + len(b) - common)`. 1 for identical
 * strings, 0 for wholly disjoint ones. Used to decide whether two blocks
 * across versions are "the same paragraph, reworded" (per
 * `specs/behaviors/versioning.md` § Diff step 2) rather than an unrelated
 * removal + addition.
 */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const parts = diffWordsWithSpace(a, b);
  let common = 0;
  for (const part of parts) {
    if (!part.added && !part.removed) common += part.value.length;
  }

  const union = a.length + b.length - common;
  return union > 0 ? common / union : 1;
}
