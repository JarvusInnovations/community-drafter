import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `specs/screens/deliverable.md` § Design: "Inter, self-hosted with the app
 * and embedded in the render ... no third-party font request, on paper as
 * on screen." The renderer loads a `file://` document with no network
 * access, so the only way the printed page gets the same typeface the
 * screen uses is to carry it: the woff2 is read from the package once and
 * inlined as a data URI.
 *
 * Deliberately non-fatal. A deployment that somehow lacks the package still
 * gets a readable statement in the system sans-serif fallback; losing the
 * typeface is not a reason to refuse to print the document.
 */
const FONT_SPECIFIER = "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";

let cached: string | null | undefined;

/** The `@font-face` block, or `""` when the font file cannot be read. */
export function interFontFace(): string {
  if (cached === undefined) cached = loadFont();
  if (!cached) return "";
  return `@font-face {
  font-family: "Inter Variable";
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  src: url(data:font/woff2;base64,${cached}) format("woff2");
}`;
}

function loadFont(): string | null {
  try {
    const resolved = import.meta.resolve(FONT_SPECIFIER);
    return readFileSync(fileURLToPath(resolved)).toString("base64");
  } catch {
    return null;
  }
}

/** Test-only: drop the memoized font so a case can assert the fallback path. */
export function resetFontCache(): void {
  cached = undefined;
}
