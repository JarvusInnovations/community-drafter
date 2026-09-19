import { describe, expect, it } from "bun:test";

/**
 * The browser-facing entry (`src/browser.ts`: anchors + diff + the DOM
 * helpers) must stay out of `render/`'s `unified`/remark/rehype dependency
 * graph — that pipeline alone is well over this budget. This builds it in
 * isolation and gzips the minified output, per
 * `plans/render-and-diff.md`'s Validation criterion (<25 KB gzipped).
 */
describe("browser bundle", () => {
  it("is under 25 KB minified + gzipped, and does not pull in the render pipeline", async () => {
    const result = await Bun.build({
      entrypoints: [new URL("./browser.ts", import.meta.url).pathname],
      minify: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);

    const code = await result.outputs[0]!.text();
    expect(code).not.toContain("unified");
    expect(code).not.toContain("remark");
    expect(code).not.toContain("rehype");

    const gzipped = Bun.gzipSync(new TextEncoder().encode(code));
    expect(gzipped.length).toBeLessThan(25 * 1024);
  });
});
