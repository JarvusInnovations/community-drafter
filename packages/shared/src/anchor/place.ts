import type { Block } from "../render/types.ts";
import type { Anchor, AnchorPlacement } from "./types.ts";

/** Below this many characters, a zero-score quote-search hit is discarded rather than trusted (§ the short-quote guard). */
const SHORT_QUOTE_GUARD = 20;

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const indices: number[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    indices.push(index);
    from = index + 1;
  }
  return indices;
}

function headingPathsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function scoreOccurrence(anchor: Anchor, block: Block, offset: number): number {
  let score = 0;

  const actualPrefix = block.text.slice(Math.max(0, offset - anchor.prefix.length), offset);
  if (anchor.prefix.length > 0 && actualPrefix === anchor.prefix) score += 2;

  const suffixStart = offset + anchor.quote.length;
  const actualSuffix = block.text.slice(suffixStart, suffixStart + anchor.suffix.length);
  if (anchor.suffix.length > 0 && actualSuffix === anchor.suffix) score += 2;

  if (anchor.heading_path.length > 0 && headingPathsEqual(block.headingPath, anchor.heading_path)) {
    score += 1;
  }

  return score;
}

function placeAtOffset(
  blockId: string,
  start: number,
  quote: string,
  confidence: AnchorPlacement["confidence"],
): AnchorPlacement {
  return { blockId, start, length: quote.length, confidence };
}

/**
 * Re-anchors a comment against the currently displayed version's blocks, per
 * `specs/behaviors/inline-comments.md` § Re-anchoring on display, steps 1–4.
 *
 * `displayedVersion` is the version number of `blocks`; it distinguishes step
 * 1 (`"exact"`: same version as the anchor) from step 2 (`"block"`: a later
 * or earlier version whose block id happens to still be present because its
 * text never changed).
 */
export function placeAnchor(
  anchor: Anchor,
  blocks: Block[],
  displayedVersion: number,
): AnchorPlacement | null {
  if (anchor.quote.length === 0) return null;

  // Steps 1 & 2: block id still present in the displayed version.
  const block = blocks.find((candidate) => candidate.id === anchor.block);
  if (block) {
    const candidateText = block.text.slice(anchor.start, anchor.start + anchor.quote.length);
    if (candidateText === anchor.quote) {
      const confidence = displayedVersion === anchor.version ? "exact" : "block";
      return placeAtOffset(block.id, anchor.start, anchor.quote, confidence);
    }
  }

  // Step 3: quote search across all blocks, scored by prefix/suffix/heading agreement.
  let best: { blockId: string; offset: number; score: number } | null = null;
  for (const candidate of blocks) {
    for (const offset of findAllOccurrences(candidate.text, anchor.quote)) {
      const score = scoreOccurrence(anchor, candidate, offset);
      if (!best || score > best.score) {
        best = { blockId: candidate.id, offset, score };
      }
    }
  }

  if (!best) return null; // Step 4: not found.
  if (best.score === 0 && anchor.quote.length < SHORT_QUOTE_GUARD) return null; // The short-quote guard.

  return placeAtOffset(best.blockId, best.offset, anchor.quote, "quote");
}
