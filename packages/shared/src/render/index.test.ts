import { describe, expect, it } from "bun:test";

import {
  CHARTER_V1,
  CHARTER_V2,
  DUPLICATE_BLOCKS_FIXTURE,
  RAW_HTML_FIXTURE,
} from "./__fixtures__.ts";
import { render } from "./index.ts";

describe("render", () => {
  it("strips raw HTML (script tags and event-handler attributes)", () => {
    const { html } = render(RAW_HTML_FIXTURE);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<a ");
    expect(html).toContain("Click this link, or don't.");
  });

  it("gives headings slugs (rehype-slug)", () => {
    const { html } = render(CHARTER_V1);
    expect(html).toContain('<h1 id="save-the-academy-charter"');
    expect(html).toContain('<h2 id="1-purpose"');
    expect(html).toContain('<h2 id="4-signatories"');
  });

  it("assigns data-block ids to paragraphs, headings, list items, blockquote paragraphs and table cells", () => {
    const { blocks } = render(CHARTER_V1);
    const byText = (text: string) => blocks.find((block) => block.text === text);

    expect(byText("Save the Academy Charter")?.tag).toBe("h1");
    expect(byText("1. Purpose")?.tag).toBe("h2");
    expect(byText("Protect the museum collection from deaccession.")?.tag).toBe("li");
    expect(byText("Silence is consent, and we say so on the post.")?.tag).toBe("p");
    expect(byText("Name")?.tag).toBe("th");
    expect(byText("Jane Doe")?.tag).toBe("td");

    for (const block of blocks) {
      expect(block.id).toMatch(/^b-[0-9a-f]{8}(-\d+)?$/);
    }
  });

  it("records heading_path as the ancestor headings, shallow to deep", () => {
    const { blocks } = render(CHARTER_V1);
    const quote = blocks.find((block) => block.text.startsWith("Silence is consent"));
    expect(quote?.headingPath).toEqual([
      "Save the Academy Charter",
      "3. How a statement becomes the coalition's",
    ]);

    const title = blocks.find((block) => block.text === "Save the Academy Charter");
    expect(title?.headingPath).toEqual([]);
  });

  it("gives duplicate-text blocks in the same render ordinal suffixes", () => {
    const { blocks } = render(DUPLICATE_BLOCKS_FIXTURE);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toBe("Sign here.");
    expect(blocks[1]?.text).toBe("Sign here.");
    expect(blocks[1]?.id).toBe(`${blocks[0]?.id}-2`);
  });

  it("keeps ids stable across versions for untouched blocks, and changes ids only where text changed", () => {
    const v1 = render(CHARTER_V1);
    const v2 = render(CHARTER_V2);
    const idsById = (version: typeof v1) =>
      new Map(version.blocks.map((block) => [block.text, block.id]));
    const v1ById = idsById(v1);
    const v2ById = idsById(v2);

    // Untouched text keeps its id.
    for (const text of [
      "Save the Academy Charter",
      "1. Purpose",
      "2. Commitments",
      "Preserve public access to the library.",
      "Sustain funding for education programs.",
      "3. How a statement becomes the coalition's",
      "Comments are open for two weeks before publication.",
      "4. Signatories",
      "Name",
      "Capacity",
      "Jane Doe",
      "River Trust",
      "Organization",
      "Thank you for reading this draft charter.",
    ]) {
      expect(v2ById.get(text)).toBe(v1ById.get(text));
    }

    // Changed text gets a different id in each version.
    expect(v1ById.get("Protect the museum collection from deaccession.")).toBeDefined();
    expect(v2ById.get("Protect the museum collection from deaccession.")).toBeUndefined();
  });
});
