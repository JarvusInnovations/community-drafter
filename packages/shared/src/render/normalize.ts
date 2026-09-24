/**
 * Text normalization used both for block-id hashing (render/block-ids.ts) and
 * for the diff/anchor similarity math. Pure string logic; browser-safe.
 */

/** Unicode NFC, whitespace collapsed to single spaces, case preserved. */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** A block's normalized text plus the index maps between it and the raw text. */
export interface NormalizedOffsets {
  /** The normalized text — equal to `normalizeText(raw)`. */
  text: string;
  /** Offset in `text` for each offset in `raw` (length `raw.length + 1`). */
  rawToNormalized: number[];
  /** Offset in `raw` for each offset in `text` (length `text.length + 1`). */
  normalizedToRaw: number[];
}

const WHITESPACE = /\s/u;

/**
 * `normalizeText`, but keeping the index maps both ways.
 *
 * A block's `text` is normalized (`render/block-ids.ts`), while a DOM
 * selection's offsets are raw character counts over the block's text nodes.
 * Rendered markdown puts whitespace inside a block often enough — a loose
 * list item is `<li>\n<p>…</p>\n</li>` — that treating one as the other
 * silently shifts every anchor in the block, which is what dropped the first
 * character of a quoted excerpt (issue #73).
 */
export function normalizeOffsets(raw: string): NormalizedOffsets {
  const rawToNormalized: number[] = Array.from({ length: raw.length + 1 }, () => 0);
  const normalizedToRaw: number[] = [];
  let out = "";
  let i = 0;

  while (i < raw.length) {
    const char = raw[i] as string;
    if (!WHITESPACE.test(char)) {
      rawToNormalized[i] = out.length;
      normalizedToRaw[out.length] = i;
      out += char;
      i += 1;
      continue;
    }

    let end = i;
    while (end < raw.length && WHITESPACE.test(raw[end] as string)) end += 1;
    const leading = out.length === 0;
    const trailing = end >= raw.length;
    if (leading || trailing) {
      // Trimmed away: every offset inside the run sits at the nearest edge.
      for (let k = i; k < end; k += 1) rawToNormalized[k] = out.length;
    } else {
      const space = out.length;
      normalizedToRaw[space] = i;
      out += " ";
      for (let k = i; k < end; k += 1) rawToNormalized[k] = k === i ? space : space + 1;
    }
    i = end;
  }

  rawToNormalized[raw.length] = out.length;
  normalizedToRaw[out.length] = raw.length;
  return { text: out.normalize("NFC"), rawToNormalized, normalizedToRaw };
}
