#!/usr/bin/env bun
/**
 * `specs/architecture.md` § Web app: "Bundle budget for the participant
 * entry: under 120 KB gzipped JS on first load, measured in CI." Reads
 * `dist/index.html` for the script/`modulepreload` set the browser fetches
 * before any route renders — the eager, first-load payload — and sums each
 * file's gzip size. Deliberately does not include chunks reachable only via
 * `import()` (the code-split history/compare/comment/prefs routes,
 * `src/App.tsx`): those are lazy by design precisely so they don't count
 * against this budget.
 *
 * Run after `vite build`, e.g. `cd apps/web && bun run build && bun run
 * scripts/check-bundle-size.ts` — wired into `.github/workflows/test.yml`'s
 * web job, after its `Build` step.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES = 120 * 1024;
const DIST_DIR = join(import.meta.dirname, "..", "dist");
const INDEX_HTML = join(DIST_DIR, "index.html");

export function eagerAssetPaths(html: string): string[] {
  const paths = new Set<string>();
  const pattern = /(?:src|href)="(\/assets\/[^"]+\.js)"/gu;
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    if (href) {
      paths.add(href);
    }
  }
  return [...paths];
}

function main(): void {
  let html: string;
  try {
    html = readFileSync(INDEX_HTML, "utf8");
  } catch {
    console.error(`Could not read ${INDEX_HTML} — run \`vite build\` first.`);
    process.exit(1);
  }

  const assetPaths = eagerAssetPaths(html);
  if (assetPaths.length === 0) {
    console.error(`No eager <script>/modulepreload JS assets found in ${INDEX_HTML}.`);
    process.exit(1);
  }

  let totalGzipBytes = 0;
  const rows: { path: string; gzipBytes: number }[] = [];
  for (const assetPath of assetPaths) {
    const filePath = join(DIST_DIR, assetPath.replace(/^\//u, ""));
    const raw = readFileSync(filePath);
    const gzipBytes = Bun.gzipSync(raw).byteLength;
    totalGzipBytes += gzipBytes;
    rows.push({ path: assetPath, gzipBytes });
  }

  for (const row of rows.toSorted((a, b) => b.gzipBytes - a.gzipBytes)) {
    console.log(`${(row.gzipBytes / 1024).toFixed(2).padStart(8)} KB gzip  ${row.path}`);
  }
  console.log(
    `${(totalGzipBytes / 1024).toFixed(2).padStart(8)} KB gzip  TOTAL (budget: ${BUDGET_BYTES / 1024} KB)`,
  );

  if (totalGzipBytes > BUDGET_BYTES) {
    console.error(
      `\nParticipant entry is ${(totalGzipBytes / 1024).toFixed(2)} KB gzipped, over the ${BUDGET_BYTES / 1024} KB budget (specs/architecture.md).`,
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
