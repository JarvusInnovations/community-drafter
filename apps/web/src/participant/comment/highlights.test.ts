import type { Anchor } from "@community-drafter/shared/browser";
import { afterEach, describe, expect, it } from "bun:test";

import { applyHighlights, clearHighlights } from "./highlights.ts";

function mount(html: string): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

function makeAnchor(overrides: Partial<Anchor>): Anchor {
  return {
    version: 1,
    commit: "",
    block: "b-para1",
    heading_path: [],
    quote: "quick brown fox",
    prefix: "",
    suffix: "",
    start: 4,
    ...overrides,
  };
}

describe("applyHighlights / clearHighlights", () => {
  it("wraps a placeable anchor in a <mark> and reports it placed", () => {
    const container = mount('<p data-block="b-para1">The quick brown fox jumps.</p>');
    const anchor = makeAnchor({});
    const clicked: string[] = [];

    const results = applyHighlights(container, [{ id: "c1", anchor, kind: "pending" }], 1, (id) =>
      clicked.push(id),
    );

    expect(results).toEqual([{ id: "c1", placed: true }]);
    const mark = container.querySelector("mark");
    expect(mark).toBeTruthy();
    expect(mark?.textContent).toBe("quick brown fox");

    mark?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(clicked).toEqual(["c1"]);
  });

  it("reports an unplaceable anchor (quote no longer present) without throwing", () => {
    const container = mount('<p data-block="b-para1">Completely different text now.</p>');
    const anchor = makeAnchor({});

    const results = applyHighlights(
      container,
      [{ id: "c1", anchor, kind: "pending" }],
      2,
      () => {},
    );
    expect(results).toEqual([{ id: "c1", placed: false }]);
    expect(container.querySelector("mark")).toBeNull();
  });

  it("is idempotent: re-applying tears down previous marks instead of stacking them", () => {
    const container = mount('<p data-block="b-para1">The quick brown fox jumps.</p>');
    const anchor = makeAnchor({});

    applyHighlights(container, [{ id: "c1", anchor, kind: "pending" }], 1, () => {});
    applyHighlights(container, [{ id: "c1", anchor, kind: "pending" }], 1, () => {});

    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container.textContent).toBe("The quick brown fox jumps.");
  });

  it("clearHighlights removes marks and restores the original text", () => {
    const container = mount('<p data-block="b-para1">The quick brown fox jumps.</p>');
    applyHighlights(
      container,
      [{ id: "c1", anchor: makeAnchor({}), kind: "pending" }],
      1,
      () => {},
    );
    expect(container.querySelector("mark")).toBeTruthy();

    clearHighlights(container);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("The quick brown fox jumps.");
  });
});
