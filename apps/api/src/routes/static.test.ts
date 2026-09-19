import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { createTestDataRepo } from "../storage/test-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** A tiny stand-in for a real `vite build` output, just enough to exercise the routes. */
function buildFixtureDist(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cd-web-dist-"));
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Community Drafter</title>");
  writeFileSync(join(root, "assets", "index-abc123.js"), "console.log('participant entry');");
  writeFileSync(join(root, "favicon.svg"), "<svg></svg>");
  writeFileSync(join(root, "icons.svg"), "<svg></svg>");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("static SPA serving", () => {
  it("serves index.html for the SPA shell prefixes and assets for hashed files", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist();
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      disablePhaseObserver: true,
      static: { root },
    });
    await server.ready();

    for (const path of [
      "/",
      "/i/some-token",
      "/i/some-token/history",
      "/d/some-slug",
      "/admin/dashboard",
    ]) {
      const response = await server.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("Community Drafter");
    }

    const asset = await server.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("participant entry");

    const favicon = await server.inject({ method: "GET", url: "/favicon.svg" });
    expect(favicon.statusCode).toBe(200);

    await server.close();
  });

  it("keeps the JSON API routes taking precedence over the SPA fallback", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist();
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      disablePhaseObserver: true,
      static: { root },
    });
    await server.ready();

    // An unknown token still resolves through the participant JSON route
    // (and its `not_found` error envelope), not the HTML SPA shell.
    const response = await server.inject({ method: "GET", url: "/i/unknown-token/api/bundle" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");

    await server.close();
  });

  it("404s for an unknown asset path instead of falling back to index.html", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist();
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      disablePhaseObserver: true,
      static: { root },
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/assets/does-not-exist.js" });
    expect(response.statusCode).toBe(404);

    await server.close();
  });

  /**
   * `specs/screens/public-and-embed.md` route table's "Framing" column +
   * `plans/public-and-embed.md` § "Frameability headers": `frame-ancestors
   * *` with no `X-Frame-Options` on `/d/:slug/embed` and
   * `/d/:slug/signatories` only; `frame-ancestors 'none'` + `X-Frame-Options:
   * DENY` on every other HTML response, including every `/i/*` page
   * (`specs/behaviors/access-and-identity.md` § Public links: "Personal
   * links are never embeddable").
   */
  it("sets frame-ancestors '*' only on /d/:slug/embed and /d/:slug/signatories", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist();
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      disablePhaseObserver: true,
      static: { root },
    });
    await server.ready();

    const frameable = ["/d/some-slug/embed", "/d/some-slug/signatories"];
    for (const path of frameable) {
      const response = await server.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-security-policy"]).toBe("frame-ancestors *");
      expect(response.headers["x-frame-options"]).toBeUndefined();
    }

    const notFrameable = [
      "/",
      "/i/some-token",
      "/i/some-token/history",
      "/d/some-slug",
      "/d/some-slug/history",
      "/d/some-slug/history/compare",
      "/admin/dashboard",
    ];
    for (const path of notFrameable) {
      const response = await server.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
      expect(response.headers["x-frame-options"]).toBe("DENY");
    }

    await server.close();
  });
});
