import { describe, expect, it } from "bun:test";
import { anchorFromSelection, computeAnchor } from "@community-drafter/shared/browser";

import { blocksFromDom } from "./blocks.ts";

/**
 * Issue #73: "Quoted excerpt on a saved inline comment drops its first
 * character." A loose list item renders as `<li>\n<p>Item</p>\n</li>`, so
 * the selection's raw DOM offsets ran one character ahead of the block's
 * normalized `text` — and `computeAnchor` sliced the quote at the wrong
 * place. Exercised against a real (happy-dom) document because the mismatch
 * only exists between the DOM walk and the normalized block text.
 */
function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

function quoteFor(container: HTMLElement, node: Text, start: number, length: number): string {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + length);
  const info = anchorFromSelection(range, container);
  expect(info).not.toBeNull();
  const anchor = computeAnchor({
    blocks: blocksFromDom(container),
    blockId: info!.blockId,
    start: info!.start,
    length: info!.length,
    version: 1,
    commit: "",
  });
  return anchor.quote;
}

describe("selection → anchor quote", () => {
  it("keeps the first character of a quote in a loose list item", () => {
    const container = mount(
      '<ul><li data-block="b-1">\n<p>Protect the collections first</p>\n</li></ul>',
    );
    const text = container.querySelector("p")!.firstChild as Text;

    expect(quoteFor(container, text, 0, 7)).toBe("Protect");
    expect(quoteFor(container, text, 8, 3)).toBe("the");
  });

  it("keeps the first character of a quote in a plain paragraph", () => {
    const container = mount('<p data-block="b-2">Protect the collections first</p>');
    const text = container.firstChild!.firstChild as Text;

    expect(quoteFor(container, text, 0, 7)).toBe("Protect");
  });

  it("is unaffected by whitespace between inline elements", () => {
    const container = mount('<p data-block="b-3">\n  Keep <em>every</em> word\n</p>');
    const em = container.querySelector("em")!.firstChild as Text;

    expect(quoteFor(container, em, 0, 5)).toBe("every");
  });
});
