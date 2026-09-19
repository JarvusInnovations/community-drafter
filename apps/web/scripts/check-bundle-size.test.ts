import { describe, expect, it } from "bun:test";

import { eagerAssetPaths } from "./check-bundle-size.ts";

describe("eagerAssetPaths", () => {
  it("collects the entry script and modulepreload chunks, not lazy-only chunks", () => {
    const html = `<!doctype html>
<html>
  <head>
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-def456.js">
    <link rel="modulepreload" crossorigin href="/assets/copy-ghi789.js">
    <link rel="stylesheet" crossorigin href="/assets/index-xyz.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

    expect(eagerAssetPaths(html)).toEqual([
      "/assets/index-abc123.js",
      "/assets/rolldown-runtime-def456.js",
      "/assets/copy-ghi789.js",
    ]);
  });

  it("ignores CSS and returns an empty list when there are no JS assets", () => {
    const html = `<link rel="stylesheet" href="/assets/index.css">`;
    expect(eagerAssetPaths(html)).toEqual([]);
  });

  it("deduplicates a path referenced more than once", () => {
    const html = `
      <script type="module" src="/assets/index-abc123.js"></script>
      <link rel="modulepreload" href="/assets/index-abc123.js">
    `;
    expect(eagerAssetPaths(html)).toEqual(["/assets/index-abc123.js"]);
  });
});
