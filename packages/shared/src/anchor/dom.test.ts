import { describe, expect, it } from "bun:test";

/**
 * `anchor/dom.ts` is browser-only (TreeWalker/Range/Document). Bun has no
 * DOM, so we can't exercise its functions here — only confirm the module
 * itself has no top-level DOM access, i.e. it's safe to *import* under Bun
 * (per `plans/render-and-diff.md`: "keep it importable without executing
 * in Bun tests"). Functional coverage of DOM behavior is unverified under
 * this test runner; see the PR description.
 */
describe("anchor/dom", () => {
  it("imports cleanly under Bun (no top-level DOM access) and exports its functions", async () => {
    const mod = await import("./dom.ts");
    expect(typeof mod.anchorFromSelection).toBe("function");
    expect(typeof mod.rangeFromAnchorPlacement).toBe("function");
  });
});
