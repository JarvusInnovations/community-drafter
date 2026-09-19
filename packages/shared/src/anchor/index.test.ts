import { describe, expect, it } from "bun:test";

import { render } from "../render/index.ts";
import { CHARTER_V1, CHARTER_V2, CHARTER_V3 } from "../render/__fixtures__.ts";
import type { Block } from "../render/types.ts";
import { computeAnchor, placeAnchor } from "./index.ts";

function block(overrides: Partial<Block> & Pick<Block, "id" | "text">): Block {
  return { headingPath: [], tag: "p", html: "", ...overrides };
}

describe("computeAnchor", () => {
  const blocks: Block[] = [
    block({
      id: "b-11111111",
      text: "Silence is consent, and we say so on the post.",
      headingPath: ["3. Consent"],
    }),
  ];

  it("captures quote/prefix/suffix/heading_path from a block + offset", () => {
    const anchor = computeAnchor({
      blocks,
      blockId: "b-11111111",
      start: 24,
      length: 22,
      version: 3,
      commit: "a1b2c3d",
    });
    expect(anchor).toEqual({
      version: 3,
      commit: "a1b2c3d",
      block: "b-11111111",
      heading_path: ["3. Consent"],
      quote: "we say so on the post.",
      prefix: "Silence is consent, and ",
      suffix: "",
      start: 24,
    });
  });

  it("truncates at the block's end and flags spans_blocks when the selection runs past it", () => {
    const anchor = computeAnchor({
      blocks,
      blockId: "b-11111111",
      start: 37,
      length: 100,
      version: 3,
      commit: "a1b2c3d",
    });
    expect(anchor.quote).toBe("the post.");
    expect(anchor.suffix).toBe("");
    expect(anchor.spans_blocks).toBe(true);
  });

  it("throws for an unknown block id", () => {
    expect(() =>
      computeAnchor({ blocks, blockId: "b-missing", start: 0, length: 1, version: 1, commit: "x" }),
    ).toThrow();
  });
});

describe("placeAnchor", () => {
  it("same version: exact placement at the recorded offset", () => {
    const blocks: Block[] = [
      block({ id: "b-11111111", text: "Silence is consent, and we say so on the post." }),
    ];
    const anchor = computeAnchor({
      blocks,
      blockId: "b-11111111",
      start: 0,
      length: 19,
      version: 3,
      commit: "c3",
    });

    const placement = placeAnchor(anchor, blocks, 3);
    expect(placement).toEqual({ blockId: "b-11111111", start: 0, length: 19, confidence: "exact" });
  });

  it('moved/later version, block id unchanged: placement via id (confidence "block")', () => {
    const v1 = render(CHARTER_V1);
    const v3 = render(CHARTER_V3);
    const untouched = v1.blocks.find(
      (b) => b.text === "Comments are open for two weeks before publication.",
    )!;

    const anchor = computeAnchor({
      blocks: v1.blocks,
      blockId: untouched.id,
      start: 0,
      length: 9,
      version: 1,
      commit: "c1",
    });
    const placement = placeAnchor(anchor, v3.blocks, 3);

    expect(placement).toEqual({ blockId: untouched.id, start: 0, length: 9, confidence: "block" });
  });

  it('reworded paragraph: placement via quote + surrounding context (confidence "quote")', () => {
    const v1 = render(CHARTER_V1);
    const v2 = render(CHARTER_V2);
    const purposeV1 = v1.blocks.find((b) => b.text.startsWith("We, the undersigned"))!;
    const purposeV2 = v2.blocks.find((b) => b.text.startsWith("We, the undersigned"))!;

    const quote = "the undersigned members of the community";
    const start = purposeV1.text.indexOf(quote);
    const anchor = computeAnchor({
      blocks: v1.blocks,
      blockId: purposeV1.id,
      start,
      length: quote.length,
      version: 1,
      commit: "c1",
    });

    // The v1 block id no longer exists in v2 (its text changed), so this can
    // only be found by the quote+context search.
    expect(v2.blocks.some((b) => b.id === purposeV1.id)).toBe(false);

    const placement = placeAnchor(anchor, v2.blocks, 2);
    expect(placement).toEqual({
      blockId: purposeV2.id,
      start,
      length: quote.length,
      confidence: "quote",
    });
  });

  it("the short-quote guard: a 12-character quote with zero context agreement returns null", () => {
    const from = block({
      id: "b-aaaaaaaa",
      text: "Zebra crossing regulations apply near the school gate.",
    });
    const to = block({
      id: "b-bbbbbbbb",
      text: "A completely different sentence, but it still says regulations apply somewhere.",
    });

    // "regulations" (11 chars) plus its trailing space, to hit exactly 12; no prefix/suffix/heading agreement.
    const anchor = computeAnchor({
      blocks: [from],
      blockId: from.id,
      start: from.text.indexOf("regulations"),
      length: 12,
      version: 1,
      commit: "c1",
    });
    expect(anchor.quote).toHaveLength(12);

    const placement = placeAnchor(anchor, [to], 2);
    expect(placement).toBeNull();
  });

  it("a longer (>=20 char) zero-context quote still places, since the guard only protects short quotes", () => {
    const from = block({
      id: "b-aaaaaaaa",
      text: "Zebra crossing regulations apply near the school gate.",
    });
    const to = block({
      id: "b-bbbbbbbb",
      text: "Somewhere else entirely, crossing regulations apply to bicycles too.",
    });

    const longQuote = "crossing regulations apply"; // 27 chars, present verbatim in both but with different surroundings
    const start = from.text.indexOf(longQuote);
    const anchor = computeAnchor({
      blocks: [from],
      blockId: from.id,
      start,
      length: longQuote.length,
      version: 1,
      commit: "c1",
    });
    expect(anchor.quote.length).toBeGreaterThanOrEqual(20);

    const placement = placeAnchor(anchor, [to], 2);
    expect(placement?.confidence).toBe("quote");
    expect(placement?.blockId).toBe(to.id);
  });

  it("not found: quote absent from every block in the displayed version", () => {
    const anchor = computeAnchor({
      blocks: [block({ id: "b-11111111", text: "This sentence will not survive at all." })],
      blockId: "b-11111111",
      start: 0,
      length: 15,
      version: 1,
      commit: "c1",
    });

    const displayed = [
      block({ id: "b-22222222", text: "A wholly rewritten paragraph with nothing in common." }),
    ];
    expect(placeAnchor(anchor, displayed, 2)).toBeNull();
  });
});
