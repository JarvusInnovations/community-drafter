import { afterEach, describe, expect, it } from "bun:test";

import { wireSelectionCapture } from "./selection.ts";

function mount(html: string): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

function selectText(container: HTMLElement, start: number, end: number): void {
  const p = container.querySelector("p")!;
  const textNode = p.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("wireSelectionCapture", () => {
  it("captures on mouseup for a qualifying selection inside a commentable block", () => {
    const container = mount('<p data-block="b-1">Hello there world</p>');
    const calls: unknown[] = [];
    const cleanup = wireSelectionCapture(container, (info) => calls.push(info));

    selectText(container, 0, 5);
    container.dispatchEvent(new Event("mouseup", { bubbles: true }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ blockId: "b-1", start: 0, length: 5 });
    cleanup();
  });

  it("reports null for a selection shorter than 3 characters", () => {
    const container = mount('<p data-block="b-1">Hello there world</p>');
    const calls: unknown[] = [];
    const cleanup = wireSelectionCapture(container, (info) => calls.push(info));

    selectText(container, 0, 2);
    container.dispatchEvent(new Event("mouseup", { bubbles: true }));

    expect(calls).toEqual([null]);
    cleanup();
  });

  /**
   * `specs/behaviors/inline-comments.md` § Capture: "Selection capture must
   * work with mouse and with touch long-press (listen to selection changes,
   * debounced, not only mouse-up)." Touch has no `mouseup`; this exercises
   * the `selectionchange` path a long-press relies on.
   */
  it("also captures via a debounced selectionchange listener (the touch long-press path)", async () => {
    const container = mount('<p data-block="b-1">Hello there world</p>');
    const calls: unknown[] = [];
    const cleanup = wireSelectionCapture(container, (info) => calls.push(info), { debounceMs: 10 });

    selectText(container, 6, 11);
    document.dispatchEvent(new Event("selectionchange"));

    await sleep(50);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ blockId: "b-1", start: 6, length: 5 });
    cleanup();
  });

  it("cleanup removes both listeners", () => {
    const container = mount('<p data-block="b-1">Hello there world</p>');
    const calls: unknown[] = [];
    const cleanup = wireSelectionCapture(container, (info) => calls.push(info));
    cleanup();

    selectText(container, 0, 5);
    container.dispatchEvent(new Event("mouseup", { bubbles: true }));
    expect(calls).toHaveLength(0);
  });
});
