import { describe, expect, it } from "bun:test";

import { render } from "../render/index.ts";
import { CHARTER_V1, CHARTER_V2 } from "../render/__fixtures__.ts";
import type { Block } from "../render/types.ts";
import { diffVersions } from "./index.ts";

function block(overrides: Partial<Block> & Pick<Block, "id" | "text">): Block {
  return {
    headingPath: [],
    tag: "p",
    html: `<p data-block="${overrides.id}">${overrides.text}</p>`,
    ...overrides,
  };
}

describe("diffVersions", () => {
  it("charter v1 -> v2: 4 changed, 1 added, 0 removed, with golden redline HTML", () => {
    const v1 = render(CHARTER_V1);
    const v2 = render(CHARTER_V2);
    const result = diffVersions(v1.blocks, v2.blocks);

    expect(result.summary).toEqual({ changed: 4, added: 1, removed: 0 });

    const byId = new Map(result.blocks.map((b) => [b.id, b]));

    expect(byId.get("b-229c28e9")).toEqual({
      status: "changed",
      id: "b-229c28e9",
      html: '<p data-block="b-229c28e9">We, the undersigned members of the community, affirm our commitment to preserving the academy\'s mission for future generations<ins> and the community it serves</ins>.</p>',
    });

    expect(byId.get("b-bd552ecc")).toEqual({
      status: "changed",
      id: "b-bd552ecc",
      html: '<li data-block="b-bd552ecc">Protect the museum collection from deaccession<ins> or sale</ins>.</li>',
    });

    expect(byId.get("b-6d7142d8")).toEqual({
      status: "changed",
      id: "b-6d7142d8",
      html: '<p data-block="b-6d7142d8">Silence is consent, and we say so <ins>clearly </ins>on the post.</p>',
    });

    expect(byId.get("b-625291c3")).toEqual({
      status: "changed",
      id: "b-625291c3",
      html: '<td data-block="b-625291c3">Individual<ins> signer</ins></td>',
    });

    const added = result.blocks.find((b) => b.status === "added");
    expect(added).toEqual({
      status: "added",
      id: "b-9e8d0b11",
      html: '<li data-block="b-9e8d0b11">Report progress to the community quarterly.</li>',
    });

    // Untouched blocks pass through unredlined.
    expect(byId.get("b-e6777bdc")).toEqual({
      status: "same",
      id: "b-e6777bdc",
      html: '<li data-block="b-e6777bdc">Preserve public access to the library.</li>',
    });
  });

  it("flags a formatting-only change (heading level) instead of redlining it", () => {
    const from: Block = block({ id: "b-aaaaaaaa", text: "How it works", tag: "h2" });
    const to: Block = block({ id: "b-aaaaaaaa", text: "How it works", tag: "h3" });

    const result = diffVersions([from], [to]);

    expect(result.blocks).toEqual([
      { status: "changed", id: "b-aaaaaaaa", html: to.html, format_only: true },
    ]);
    expect(result.summary).toEqual({ changed: 1, added: 0, removed: 0 });
  });

  it("flags a list-marker-only change (unordered -> ordered) instead of redlining it", () => {
    const from: Block = block({ id: "b-bbbbbbbb", text: "Step one", tag: "li", ordered: false });
    const to: Block = block({ id: "b-bbbbbbbb", text: "Step one", tag: "li", ordered: true });

    const result = diffVersions([from], [to]);

    expect(result.blocks[0]).toEqual({
      status: "changed",
      id: "b-bbbbbbbb",
      html: to.html,
      format_only: true,
    });
  });

  it("shows a moved block (unchanged text, disrupted order) as removed + added, not a mismatched pair", () => {
    const a = block({
      id: "b-11111111",
      text: "Zebra crossing regulations apply near the elementary school.",
    });
    const b1 = block({
      id: "b-22222222",
      text: "Marigolds bloom earliest among the annuals in spring gardens.",
    });
    const c = block({
      id: "b-33333333",
      text: "Turbine maintenance follows a strict quarterly inspection schedule.",
    });

    // v2 moves "Marigolds" to the end; "Zebra" and "Turbine" stay adjacent and in order.
    const result = diffVersions([a, b1, c], [a, c, b1]);

    const statuses = result.blocks.map((entry) => `${entry.status}:${entry.id}`);
    // Every occurrence of the moved block's id is a removal paired with an addition -
    // never a matched "same"/"changed" pair with a neighbor it merely sits next to now.
    expect(statuses.filter((entry) => entry.endsWith(b1.id))).toEqual([
      `removed:${b1.id}`,
      `added:${b1.id}`,
    ]);
    expect(statuses.filter((entry) => entry.endsWith(a.id))).toEqual([`same:${a.id}`]);
    expect(statuses.filter((entry) => entry.endsWith(c.id))).toEqual([`same:${c.id}`]);
    expect(result.summary).toEqual({ changed: 0, added: 1, removed: 1 });
  });

  it("treats a reworded block as changed only when similarity clears the threshold", () => {
    const from = block({
      id: "b-aaaa1111",
      text: "The quick brown fox jumps over the lazy dog in the yard.",
    });
    const to = block({
      id: "b-bbbb2222",
      text: "The quick brown fox jumps over the lazy dog in the park.",
    });

    const result = diffVersions([from], [to]);

    expect(result.blocks[0]?.status).toBe("changed");
    expect(result.blocks[0]?.html).toContain("<del>yard</del>");
    expect(result.blocks[0]?.html).toContain("<ins>park</ins>");
  });

  it("treats an unrelated replacement as a removal + addition, not a redline", () => {
    const from = block({
      id: "b-cccc3333",
      text: "Completely unrelated original sentence about gardening.",
    });
    const to = block({
      id: "b-dddd4444",
      text: "A totally different topic concerning municipal water policy.",
    });

    const result = diffVersions([from], [to]);

    expect(result.blocks.map((entry) => entry.status)).toEqual(["removed", "added"]);
    expect(result.summary).toEqual({ changed: 0, added: 1, removed: 1 });
  });
});
