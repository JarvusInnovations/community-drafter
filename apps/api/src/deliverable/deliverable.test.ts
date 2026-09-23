import { describe, expect, it } from "bun:test";

import { render } from "@signatories/shared";

import { countsSentence, deliverableCopy, joinNames } from "./copy.ts";
import { DeliverableCache } from "./cache.ts";
import { escapeHtml, renderDeliverableHtml } from "./template.ts";
import { formatDeliverableDate, parsePaper, type DeliverableView } from "./view.ts";

function view(overrides: Partial<DeliverableView> = {}): DeliverableView {
  return {
    slug: "coalition-charter",
    siteName: "Save the Academy Coalition",
    title: "Charter of the Save the Academy Coalition",
    addressedTo: [],
    versionNumber: 3,
    versionDate: "Sep 20, 2026",
    draft: true,
    bodyHtml: "<p>We, the undersigned.</p>",
    showSignatories: "list",
    signatories: { organizations: 0, individuals: 0, unlisted: 0, list: [] },
    paper: "letter",
    filename: "coalition-charter-v3-draft.pdf",
    cacheKey: "coalition-charter:abc:hash:draft:letter",
    ...overrides,
  };
}

describe("deliverable copy", () => {
  it("joins recipient names with commas and a final and", () => {
    expect(joinNames(["the Board"])).toBe("the Board");
    expect(joinNames(["the Board", "the Council"])).toBe("the Board and the Council");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });

  it("counts an unlisted signer once, in the trailing clause alone", () => {
    expect(countsSentence({ organizations: 2, individuals: 14, unlisted: 3 })).toBe(
      "Signed by 2 organizations and 14 individuals, and 3 others who asked not to be listed.",
    );
    expect(countsSentence({ organizations: 1, individuals: 1, unlisted: 1 })).toBe(
      "Signed by 1 organization and 1 individual, and 1 other who asked not to be listed.",
    );
    expect(countsSentence({ organizations: 0, individuals: 4, unlisted: 0 })).toBe(
      "Signed by 0 organizations and 4 individuals.",
    );
  });
});

describe("deliverable dates and paper", () => {
  it("writes the year, unlike a screen's date-only point", () => {
    expect(formatDeliverableDate("2026-09-20T13:14:00Z", "America/New_York")).toBe("Sep 20, 2026");
  });

  it("reads the paper size, defaulting to letter", () => {
    expect(parsePaper(undefined)).toBe("letter");
    expect(parsePaper("A4")).toBe("a4");
    expect(parsePaper("legal")).toBe("letter");
  });
});

describe("the print document", () => {
  it("carries the title block, the statement and the signatories", () => {
    const html = renderDeliverableHtml(
      view({
        addressedTo: ["the State Board of Education", "the County Commission"],
        deliveredOn: "Sep 30, 2026",
        draft: false,
        filename: "coalition-charter-v3.pdf",
        signatories: {
          organizations: 1,
          individuals: 1,
          unlisted: 2,
          list: [
            {
              display_name: "Jane Doe",
              capacity: "official",
              org: "Skype a Scientist",
              title: "Executive Director",
            },
            {
              display_name: "Alex Kim",
              capacity: "personal",
              descriptor: "neighbor and museum member",
            },
          ],
        },
      }),
    );

    expect(html).toContain("To: the State Board of Education and the County Commission");
    expect(html).toContain("Charter of the Save the Academy Coalition");
    expect(html).toContain("Version 3 · Sep 20, 2026 · delivered Sep 30, 2026");
    expect(html).toContain("We, the undersigned.");
    expect(html).toContain("Skype a Scientist");
    expect(html).toContain("Jane Doe, Executive Director");
    expect(html).toContain("Alex Kim, neighbor and museum member");
    expect(html).toContain(
      "Signed by 1 organization and 1 individual, and 2 others who asked not to be listed.",
    );
  });

  it("watermarks a draft with its version and leaves a clean copy unmarked", () => {
    const draft = renderDeliverableHtml(view({ draft: true }));
    expect(draft).toContain(">DRAFT<");
    expect(draft).toContain(
      "Draft of version 3 — the text and the signatory list may still change.",
    );

    const clean = renderDeliverableHtml(view({ draft: false }));
    expect(clean).not.toContain(">DRAFT<");
    expect(clean).not.toContain("Draft of version 3");
  });

  it("prints counts alone for show_signatories = count", () => {
    const html = renderDeliverableHtml(
      view({
        showSignatories: "count",
        signatories: { organizations: 2, individuals: 5, unlisted: 0 },
      }),
    );
    expect(html).toContain("Signed by 2 organizations and 5 individuals.");
    expect(html).not.toContain(deliverableCopy.signatories.organizations.toUpperCase());
    expect(html).not.toContain("<ul");
  });

  it("prints no signatories section at all for show_signatories = none", () => {
    const html = renderDeliverableHtml(view({ showSignatories: "none", signatories: null }));
    expect(html).not.toContain("Signatories");
    expect(html).not.toContain("Signed by");
  });

  it("says so rather than printing an empty list when nobody has signed", () => {
    const html = renderDeliverableHtml(view());
    expect(html).toContain("No signatories yet.");
  });

  it("escapes what a signer typed and refuses a site accent that is not a color", () => {
    const html = renderDeliverableHtml(
      view({
        accent: "red; } body { display: none } .x {",
        title: 'The "Academy" <script>alert(1)</script>',
        signatories: {
          organizations: 0,
          individuals: 1,
          unlisted: 0,
          list: [{ display_name: "Alex <b>Kim</b>", capacity: "personal" }],
        },
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Alex &lt;b&gt;Kim&lt;/b&gt;");
    // The accent is rejected whole rather than written into the sheet; the
    // assertion names the injected rule, because the sheet legitimately hides
    // the Sources return arrows on paper.
    expect(html).not.toContain("body { display: none }");
    expect(html).toContain("--accent: #2457f5");
  });

  it("escapes the four characters that could break out of markup", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

/**
 * `specs/screens/deliverable.md` § Display Rules 3, "Sources". The print
 * document does not build the section — it comes out of the shared render
 * in `hybrid`, the deliverable's default — so the numbering on paper is the
 * numbering the document screen shows a reader who turned footnotes on.
 */
describe("citations on paper", () => {
  const MARKDOWN =
    "We asked for [notice](https://news.example/story#:~:text=a) and again\n" +
    "for [notice](https://news.example/story#:~:text=b), plus [minutes](https://board.example/m).\n";

  it("prints the Sources list and the superscripts in hybrid", () => {
    const html = renderDeliverableHtml(
      view({ bodyHtml: render(MARKDOWN, { citations: "hybrid" }).html }),
    );
    expect(html).toContain('<h2 id="doc-sources-heading">Sources</h2>');
    expect(html).toContain("https://news.example/story");
    expect(html).toContain("https://board.example/m");
    expect(html).toContain('class="citation-ref"');
    // One entry per source, not one per citation.
    expect(html.match(/<li id="src-\d+"/gu)).toHaveLength(2);
    // The stylesheet has to style what the render emits.
    expect(html).toContain(".statement .doc-sources");
    expect(html).toContain("sup.citation-ref");
  });

  it("prints no Sources list in links mode", () => {
    const html = renderDeliverableHtml(
      view({ bodyHtml: render(MARKDOWN, { citations: "links" }).html }),
    );
    // Only the body, not the stylesheet — which names both classes either way.
    const statement = html.slice(html.indexOf('<section class="statement">'));
    expect(statement).not.toContain("Sources</h2>");
    expect(statement).not.toContain("citation-ref");
    expect(statement).toContain('<a href="https://board.example/m">minutes</a>');
  });
});

describe("the render cache", () => {
  it("returns a render only while its key and its lifetime hold", () => {
    const cache = new DeliverableCache(2, 1_000);
    const bytes = new Uint8Array([1, 2, 3]);
    cache.set("a", bytes, 0);
    expect(cache.get("a", 500)).toBe(bytes);
    expect(cache.get("a", 2_000)).toBeUndefined();
    expect(cache.get("b", 500)).toBeUndefined();
  });

  it("evicts the least recently used once it is over its bound", () => {
    const cache = new DeliverableCache(2, 10_000);
    cache.set("a", new Uint8Array([1]), 0);
    cache.set("b", new Uint8Array([2]), 0);
    cache.get("a", 1);
    cache.set("c", new Uint8Array([3]), 1);
    expect(cache.size).toBe(2);
    expect(cache.get("b", 2)).toBeUndefined();
    expect(cache.get("a", 2)).toBeDefined();
    expect(cache.get("c", 2)).toBeDefined();
  });
});
