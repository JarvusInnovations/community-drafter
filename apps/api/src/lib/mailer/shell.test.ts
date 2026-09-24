import { describe, expect, it } from "bun:test";

import { firstName, renderEmail } from "./shell.ts";

describe("email shell", () => {
  it("renders the same words in the text and HTML parts with one button", () => {
    const { text, html } = renderEmail({
      greeting: "Hi Jane,",
      body: ["Something happened.", "- first item", "- second <item>", "Comments close soon."],
      button: { label: "Read and sign", url: "https://example.org/i/abc?x=1&y=2" },
      alsoLink: { label: "Read the whole document", url: "https://example.org/i/abc" },
      smallPrint: ["This link is yours alone; please don't forward it."],
      footerLinks: [{ label: "Manage how we contact you", url: "https://example.org/i/abc/prefs" }],
    });

    expect(text).toBe(
      [
        "Hi Jane,",
        "Something happened.",
        "- first item",
        "- second <item>",
        "Comments close soon.",
        "Read and sign: https://example.org/i/abc?x=1&y=2",
        "Read the whole document: https://example.org/i/abc",
        "This link is yours alone; please don't forward it.\nManage how we contact you: https://example.org/i/abc/prefs",
      ].join("\n\n") + "\n",
    );

    expect(html.match(/display:inline-block;background:#2457f5/g)).toHaveLength(1);
    expect(html).toContain('href="https://example.org/i/abc?x=1&amp;y=2"');
    expect(html).toContain('<li style="margin:0 0 6px">second &lt;item&gt;</li>');
    expect(html).toContain("Or paste this link into your browser:");
    expect(html).not.toContain("<img");
  });

  it("takes the first name from a full name and leaves emails and single words alone", () => {
    expect(firstName("Jane Doe")).toBe("Jane");
    expect(firstName("  Jane   Q. Doe ")).toBe("Jane");
    expect(firstName("jane@example.org")).toBe("jane@example.org");
    expect(firstName("Cher")).toBe("Cher");
    expect(firstName("Rev. Tomás Ferreira")).toBe("Rev. Ferreira");
    expect(firstName("Dr Priya Raman")).toBe("Dr Raman");
    expect(firstName("Sr. Margaret Doyle")).toBe("Sr. Doyle");
  });
});
