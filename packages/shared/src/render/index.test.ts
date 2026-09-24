import { describe, expect, it } from "bun:test";

import {
  BLOCK_CLASSES_FIXTURE,
  CHARTER_V1,
  CHARTER_V2,
  CITATIONS_FIXTURE,
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

/** `specs/behaviors/versioning.md` § Citations. */
describe("render citations", () => {
  it("leaves links alone in `links` mode and appends nothing", () => {
    const { html } = render(CITATIONS_FIXTURE, { citations: "links" });
    expect(html).toContain('<a href="https://news.example/story#:~:text=one">notice</a>');
    expect(html).not.toContain("citation-ref");
    expect(html).not.toContain("doc-sources");
    expect(html).toBe(render(CITATIONS_FIXTURE).html);
  });

  it("de-links citations and numbers them in `footnotes` mode", () => {
    const { html } = render(CITATIONS_FIXTURE, { citations: "footnotes" });
    expect(html).not.toContain(">notice</a>");
    expect(html).toContain('notice<sup class="citation-ref" id="src-ref-1-1">');
    expect(html).toContain('<a href="#src-1" aria-label="Source 1">1</a>');
  });

  it("keeps the link and adds the number in `hybrid` mode", () => {
    const { html } = render(CITATIONS_FIXTURE, { citations: "hybrid" });
    expect(html).toContain(
      '<a href="https://news.example/story#:~:text=one">notice</a><sup class="citation-ref"',
    );
  });

  it("numbers by first appearance and gives one number to one source", () => {
    const { html } = render(CITATIONS_FIXTURE, { citations: "hybrid" });
    // The two text fragments of one article share number 1; the board minutes are 2.
    expect(html).toContain('id="src-ref-1-1"');
    expect(html).toContain('id="src-ref-1-2"');
    expect(html).toContain('id="src-ref-2-1"');
    expect(html).not.toContain('id="src-ref-3-1"');

    const sources = html.slice(html.indexOf('<section class="doc-sources"'));
    expect(sources).toContain('<h2 id="doc-sources-heading">Sources</h2>');
    // The entry shows the address without the highlight fragment, once.
    expect(sources).toContain('<li id="src-1"><a href="https://news.example/story"');
    expect(sources).toContain('<li id="src-2"><a href="https://board.example/minutes"');
    expect(sources).not.toContain("#:~:text=");
    expect(sources.match(/<li /gu)).toHaveLength(2);
  });

  it("links each number to its entry and each entry back to every place it was cited", () => {
    const { html } = render(CITATIONS_FIXTURE, { citations: "footnotes" });
    const sources = html.slice(html.indexOf('<section class="doc-sources"'));
    expect(sources).toContain('href="#src-ref-1-1"');
    expect(sources).toContain('href="#src-ref-1-2"');
    expect(sources).toContain('href="#src-ref-2-1"');
  });

  it("never numbers a visible URL, a mailto: or an in-document link", () => {
    for (const mode of ["footnotes", "hybrid"] as const) {
      const { html } = render(CITATIONS_FIXTURE, { citations: mode });
      const sources = html.slice(html.indexOf('<section class="doc-sources"'));
      expect(sources).not.toContain("mailto:");
      // The autolink and the URL-labelled link both stay links and take no number.
      expect(html).toContain('<a href="https://news.example/story">https://news.example/story</a>');
      expect(html).toContain(
        '<a href="https://board.example/minutes">https://board.example/minutes</a>',
      );
      expect(html).not.toContain(">the summary</a><sup");
    }
  });

  it("leaves a real GFM footnote and the links inside it untouched", () => {
    const links = render(CITATIONS_FIXTURE, { citations: "links" }).html;
    const footnotesOf = (html: string) => html.slice(html.indexOf("<section data-footnotes"));
    for (const mode of ["footnotes", "hybrid"] as const) {
      const html = render(CITATIONS_FIXTURE, { citations: mode }).html;
      const section = footnotesOf(html);
      // Everything up to the appended Sources section is byte-identical.
      expect(section.slice(0, section.indexOf('<section class="doc-sources"'))).toBe(
        footnotesOf(links),
      );
    }
  });

  it("produces identical blocks in every mode — a comment lands in the same place", () => {
    const modes = ["links", "footnotes", "hybrid"] as const;
    const [first, ...rest] = modes.map((citations) => render(CITATIONS_FIXTURE, { citations }));
    for (const result of rest) {
      expect(JSON.stringify(result.blocks)).toBe(JSON.stringify(first!.blocks));
    }
  });

  it("makes no commentable block out of the Sources section", () => {
    const { html, blocks } = render(CITATIONS_FIXTURE, { citations: "hybrid" });
    const sources = html.slice(html.indexOf('<section class="doc-sources"'));
    expect(sources).not.toContain("data-block");
    expect(blocks.some((block) => block.text === "Sources")).toBe(false);
  });
});

/** `specs/behaviors/versioning.md` § Rendering, § Block classes. */
describe("render block classes", () => {
  it("renders a horizontal rule", () => {
    expect(render(BLOCK_CLASSES_FIXTURE).html).toContain("<hr>");
  });

  it("takes a trailing {.class} off a paragraph and a heading", () => {
    const { html, blocks } = render(BLOCK_CLASSES_FIXTURE);
    expect(html).toContain(`<h1 class="center" id="heading"`);
    expect(html).toContain('<p class="lede"');
    // The marker is authoring syntax: it never reaches the text a comment anchors to.
    expect(blocks.some((block) => block.text.includes("{."))).toBe(false);
    expect(blocks.find((block) => block.tag === "h1")?.text).toBe("Heading");
  });

  it("wraps a ::: container in a div without making it a block", () => {
    const { html, blocks } = render(BLOCK_CLASSES_FIXTURE);
    expect(html).toContain('<div class="callout">');
    expect(blocks.some((block) => block.text.includes("The core terms"))).toBe(true);
    expect(blocks.every((block) => block.tag !== "p" || !block.html.startsWith("<div"))).toBe(true);
  });

  it("gives the paragraphs inside a container the ids they would have had without it", () => {
    const wrapped = render("::: callout\nThe core terms.\n:::\n");
    const bare = render("The core terms.\n");
    expect(wrapped.blocks[0]?.id).toBe(bare.blocks[0]!.id);
    expect(wrapped.blocks[0]?.text).toBe(bare.blocks[0]!.text);
  });

  it("discards a class that is not on the whitelist, leaving no empty attribute", () => {
    const { html } = render(BLOCK_CLASSES_FIXTURE);
    expect(html).not.toContain("sneaky");
    expect(html).not.toContain('class=""');
    expect(html).toContain("<div><p");
  });

  it("leaves prose that looks like a directive exactly as written", () => {
    const { blocks } = render(BLOCK_CLASSES_FIXTURE);
    const prose = blocks.find((block) => block.text.includes("12:30"));
    expect(prose?.text).toBe("A paragraph mentioning 12:30 and a :stray colon word.");
  });

  /**
   * `specs/behaviors/versioning.md` § Block classes: the store re-formats a
   * body on every write and joins the lines of a paragraph, so a fence hard
   * against the line below it would be swallowed into it. The blank-line
   * form is the one that survives that round trip, and so the one the spec
   * and the operator docs teach.
   */
  it("wraps a container whose fences stand alone between blank lines", () => {
    const { html, blocks } = render(
      "::: callout\n\nFirst here.\n\nSecond here.\n\n:::\n\nAfter.\n",
    );
    expect(html).toContain('<div class="callout">');
    expect(blocks.map((block) => block.text)).toEqual(["First here.", "Second here.", "After."]);
  });

  it("accepts the container fence with or without a space after the colons", () => {
    expect(render("::: lede\nHi.\n:::\n").html).toContain('<div class="lede">');
    expect(render(":::lede\nHi.\n:::\n").html).toContain('<div class="lede">');
  });

  it("does not rewrite a fence-like line inside fenced code", () => {
    const { html } = render("```\n::: lede\n```\n");
    expect(html).toContain("::: lede");
    expect(html).not.toContain("<div");
  });
});

/**
 * `specs/behaviors/inline-comments.md` § Block identity: code blocks are not
 * commentable, and adding, removing or editing one never changes another
 * block's id or text (#84).
 */
describe("render code blocks", () => {
  const WITH_CODE = [
    "# Setup",
    "",
    "Run this first.",
    "",
    "```sh",
    "Run this first.",
    "```",
    "",
    "- An item",
    "",
    "  ```",
    "  nested in the item",
    "  ```",
    "",
    "> Quoted.",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "```",
    "second",
    "block",
    "```",
    "",
    "Run this first.",
    "",
  ].join("\n");
  const WITHOUT_CODE = [
    "# Setup",
    "",
    "Run this first.",
    "",
    "- An item",
    "",
    "  ```",
    "  nested in the item",
    "  ```",
    "",
    "> Quoted.",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "Run this first.",
    "",
  ].join("\n");

  it("leaves every non-code block's id, text, tag and heading path unchanged", () => {
    const withCode = render(WITH_CODE).blocks;
    const withoutCode = render(WITHOUT_CODE).blocks;
    const identity = (blocks: typeof withCode) =>
      blocks.map(({ id, text, tag, headingPath }) => ({ id, text, tag, headingPath }));
    expect(identity(withCode)).toEqual(identity(withoutCode));
    // A code block whose text equals a paragraph's takes no ordinal from it.
    expect(withCode.filter((block) => block.text === "Run this first.").map((b) => b.id)).toEqual(
      withoutCode.filter((block) => block.text === "Run this first.").map((b) => b.id),
    );
  });

  it("gives code blocks no data-block and records them beside the blocks", () => {
    const { html, blocks, code } = render(WITH_CODE);
    expect(html).not.toMatch(/<pre[^>]*data-block/);
    expect(blocks.some((block) => block.html.startsWith("<pre"))).toBe(false);
    expect(code.map(({ text, position }) => ({ text, position }))).toEqual([
      { text: "Run this first.", position: 2 },
      { text: "second\nblock", position: 8 },
    ]);
    expect(code[0]?.id).toMatch(/^c-[0-9a-f]{8}$/);
    expect(code[0]?.html).toStartWith("<pre>");
  });

  it("leaves a code block inside a list item to that item", () => {
    const { blocks, code } = render(WITH_CODE);
    expect(code.some((entry) => entry.text.includes("nested"))).toBe(false);
    expect(blocks.find((block) => block.tag === "li")?.text).toContain("nested in the item");
  });
});
