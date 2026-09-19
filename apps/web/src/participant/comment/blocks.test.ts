import { afterEach, describe, expect, it } from "bun:test";

import { blocksFromDom } from "./blocks.ts";

function mount(html: string): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("blocksFromDom", () => {
  it("reconstructs id/text/tag/headingPath for every data-block element, in document order", () => {
    const container = mount(
      '<h2 data-block="b-head1" id="intro">Introduction</h2>' +
        '<p data-block="b-para1">First paragraph.</p>' +
        '<h3 data-block="b-head2" id="sub">Sub-heading</h3>' +
        '<p data-block="b-para2">Second paragraph.</p>',
    );

    const blocks = blocksFromDom(container);
    expect(blocks.map((b) => b.id)).toEqual(["b-head1", "b-para1", "b-head2", "b-para2"]);
    expect(blocks[1]?.text).toBe("First paragraph.");
    expect(blocks[1]?.headingPath).toEqual(["Introduction"]);
    expect(blocks[3]?.headingPath).toEqual(["Introduction", "Sub-heading"]);
    expect(blocks[1]?.tag).toBe("p");
  });

  it("skips nested container text for a list item's own block, per the server's extractBlockText", () => {
    const container = mount(
      '<ul><li data-block="b-li1">Top item<ul><li data-block="b-li2">Nested item</li></ul></li></ul>',
    );
    const blocks = blocksFromDom(container);
    const top = blocks.find((b) => b.id === "b-li1");
    expect(top?.text).toBe("Top item");
    expect(top?.ordered).toBe(false);
  });

  it("marks an li's ordered flag from its enclosing list", () => {
    const container = mount('<ol><li data-block="b-oli">Ordered item</li></ol>');
    const blocks = blocksFromDom(container);
    expect(blocks[0]?.ordered).toBe(true);
  });

  it("ignores elements without a data-block attribute", () => {
    const container = mount('<div><span>no id</span><p data-block="b-only">Text</p></div>');
    const blocks = blocksFromDom(container);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("b-only");
  });
});
