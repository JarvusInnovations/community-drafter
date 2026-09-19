/**
 * Text normalization used both for block-id hashing (render/block-ids.ts) and
 * for the diff/anchor similarity math. Pure string logic; browser-safe.
 */

/** Unicode NFC, whitespace collapsed to single spaces, case preserved. */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}
