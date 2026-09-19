import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../../app.ts";
import { createTestDataRepo } from "../../storage/test-helpers.ts";
import { seedDocument } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function buildFixtureDist(widgetSource: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cd-widget-dist-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Community Drafter</title>");
  writeFileSync(join(root, "widget.js"), widgetSource);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * `apps/api/src/routes/public/widget.ts` reads `widget.js` out of the same
 * built `apps/web/dist` directory `routes/static.ts` serves from (a `root`
 * option, overridable exactly like `static.test.ts`'s fixture pattern,
 * since `apps/web/dist` doesn't exist in this test run without a prior
 * `vite build`).
 */
describe("GET /d/:slug/widget.js", () => {
  it("serves the built widget.js with open CORS and a short cache lifetime", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist("(function(){/* widget */})();");
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      disablePhaseObserver: true,
      static: { root },
    });
    await server.ready();
    cleanups.push(() => void server.close());

    await seedDocument(server, { slug: "doc-widget", public_access: "read" });

    const response = await server.inject({ method: "GET", url: "/d/doc-widget/widget.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["cache-control"]).toContain("max-age");
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.body).toContain("widget");

    await server.close();
  });

  it("404s the same way as the bundle route when the document isn't public", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist("(function(){})();");
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      disablePhaseObserver: true,
      static: { root },
    });
    await server.ready();

    await seedDocument(server, { slug: "doc-widget-hidden", public_access: "none" });

    const widgetRes = await server.inject({ method: "GET", url: "/d/doc-widget-hidden/widget.js" });
    const bundleRes = await server.inject({
      method: "GET",
      url: "/d/doc-widget-hidden/api/bundle",
    });
    expect(widgetRes.statusCode).toBe(404);
    expect(widgetRes.json()).toEqual(bundleRes.json());

    await server.close();
  });
});
