import { describe, expect, it } from "bun:test";

import { normalizeOffsets, normalizeText } from "./normalize.ts";

describe("normalizeOffsets", () => {
  it("agrees with normalizeText on the resulting string", () => {
    for (const raw of ["Hello world", "\nItem\n", "a  b", "  padded  ", "", "   "]) {
      expect(normalizeOffsets(raw).text).toBe(normalizeText(raw));
    }
  });

  /**
   * The issue #73 case: a loose list item renders as `<li>\n<p>Item</p>\n</li>`,
   * so the DOM offset of "I" is 1 while its offset in the block's normalized
   * text is 0 — slicing the quote at the raw offset dropped the first
   * character.
   */
  it("maps a raw offset past trimmed leading whitespace to 0", () => {
    const { text, rawToNormalized } = normalizeOffsets("\nItem\n");
    expect(text).toBe("Item");
    expect(rawToNormalized[0]).toBe(0);
    expect(rawToNormalized[1]).toBe(0);
    expect(text.slice(rawToNormalized[1] as number)).toBe("Item");
  });

  it("maps across a collapsed whitespace run", () => {
    const { text, rawToNormalized, normalizedToRaw } = normalizeOffsets("a  b");
    expect(text).toBe("a b");
    // raw 3 is "b"; normalized 2 is "b".
    expect(rawToNormalized[3]).toBe(2);
    expect(normalizedToRaw[2]).toBe(3);
  });

  it("round-trips every normalized offset back into the raw string", () => {
    const raw = "\n  The  quick\tbrown fox \n";
    const { text, normalizedToRaw, rawToNormalized } = normalizeOffsets(raw);
    for (let i = 0; i <= text.length; i += 1) {
      const rawIndex = normalizedToRaw[i] as number;
      expect(typeof rawIndex).toBe("number");
      expect(rawToNormalized[rawIndex]).toBe(i);
    }
  });

  it("maps the end of the raw string to the end of the normalized text", () => {
    const raw = "Trailing space  ";
    const { text, rawToNormalized } = normalizeOffsets(raw);
    expect(rawToNormalized[raw.length]).toBe(text.length);
  });
});
