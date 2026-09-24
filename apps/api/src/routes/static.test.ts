import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { GENERIC_DESCRIPTION } from "../lib/share-preview.ts";
import { createTestDataRepo } from "../storage/test-helpers.ts";
import { seedDocument, seedParticipant, TEST_ACTOR } from "./test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** A tiny stand-in for a real `vite build` output, just enough to exercise the routes. */
function buildFixtureDist(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cd-web-dist-"));
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    // Shaped like a real `vite build` shell: the head rewrite
    // (`lib/share-preview.ts`) replaces the `<title>` and splices its tags
    // in before `</head>`, leaving the module script alone.
    '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Signatories</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/assets/index-abc123.js"></script>\n  </body>\n</html>\n',
  );
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
      static: { root },
    });
    await server.ready();

    for (const path of [
      "/",
      "/i/some-token",
      "/i/some-token/history",
      "/d/some-slug",
      "/admin/dashboard",
      "/auth/device?code=ABCD1234",
    ]) {
      const response = await server.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("Signatories");
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

  it("serves the SPA shell with a 404 for an unrouted HTML GET, and JSON otherwise", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist();
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      static: { root },
    });
    await server.ready();

    // `specs/api/conventions.md`: deny-by-default governs routes, not
    // addresses a person typed. `/login` used to reach the gateway's
    // default-deny and come back as a JSON 403 (#60).
    const page = await server.inject({
      method: "GET",
      url: "/login",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(page.statusCode).toBe(404);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("<!doctype html>");

    const json = await server.inject({
      method: "GET",
      url: "/sign-in",
      headers: { accept: "application/json" },
    });
    expect(json.statusCode).toBe(404);
    expect(json.json().error).toBe("not_found");

    // A write to an unrouted path is never handed a page to parse.
    const post = await server.inject({
      method: "POST",
      url: "/login",
      headers: { accept: "text/html" },
    });
    expect(post.statusCode).toBe(404);
    expect(post.json().error).toBe("not_found");

    await server.close();
  });

  /**
   * `specs/api/conventions.md` § URL scheme: "a path under one of the API
   * prefixes above that matches no route is a 404 like any other unrouted
   * path, and never the app's shell with a 200" (#98) — the `/admin/*`,
   * `/i/*` and `/d/*` wildcards used to swallow a mistyped endpoint and
   * answer HTML.
   */
  it("404s an unknown path under an API prefix instead of serving the SPA shell", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist();
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      static: { root },
    });
    await server.ready();

    const unknownApiPaths = [
      "/admin/api/documents/x/schedul",
      "/admin/api/nope",
      "/i/some-token/api/nope",
      "/d/some-slug/api/nope",
    ];
    for (const url of unknownApiPaths) {
      const json = await server.inject({
        method: "GET",
        url,
        headers: { accept: "application/json" },
      });
      expect(json.statusCode).toBe(404);
      expect(json.json().error).toBe("not_found");

      // Even a browser's Accept header never gets a 200 here.
      const html = await server.inject({
        method: "GET",
        url,
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      expect(html.statusCode).toBe(404);
    }

    // The client routes that live under the same prefixes still get the shell.
    for (const url of ["/admin", "/admin/api-keys", "/i/some-token/history", "/d/some-slug"]) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
    }

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

/**
 * `specs/screens/public-and-embed.md` § Share Preview and its § Principles,
 * Local ("A share preview never confirms a document exists"). The metadata
 * in the SPA shell's head is read by machines, unauthenticated, before
 * anyone clicks — so it is held to the same standard as the response body.
 */
describe("share preview metadata", () => {
  /** Every `<title>`, `<meta>` and `<link rel=canonical>` the head declares, in order. */
  function headTags(html: string): string[] {
    const head = html.slice(0, html.search(/<\/head>/iu));
    return [...head.matchAll(/<(?:title|meta|link)\b[^>]*>(?:[^<]*<\/title>)?/gu)].map((m) =>
      m[0].trim(),
    );
  }

  function metaContent(html: string, key: string): string | undefined {
    const pattern = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`, "u");
    return pattern.exec(html)?.[1];
  }

  async function buildShellServer() {
    process.env.NODE_ENV = "test";
    process.env.PUBLIC_URL = "https://drafter.example.org";
    process.env.INSTANCE_NAME = "Example Drafter";
    const { dataDir, cleanup: cleanupData } = await createTestDataRepo();
    cleanups.push(cleanupData);
    const { root, cleanup: cleanupDist } = buildFixtureDist();
    cleanups.push(cleanupDist);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
      static: { root },
    });
    await server.ready();
    cleanups.push(() => {
      delete process.env.PUBLIC_URL;
      delete process.env.INSTANCE_NAME;
      void server.close();
    });
    return server;
  }

  it("names the document on a public document page", async () => {
    const server = await buildShellServer();

    await seedDocument(server, {
      slug: "keep-the-museum-open",
      title: "Keep the Museum Open",
      public_access: "read",
      body: "# Keep the Museum Open\n\nThe board voted in March to close the doors.",
    });
    await server.storage.commit(
      "publish",
      {
        actor: TEST_ACTOR,
        subject: "publish: keep-the-museum-open v2",
        document: "keep-the-museum-open",
        version: 2,
        summary: "Named the three galleries at risk.",
      },
      async (tx) => {
        await tx.documents.patch(
          { slug: "keep-the-museum-open" },
          { body: "# Keep the Museum Open\n\nThe board voted in March to close three galleries." },
        );
      },
    );

    const response = await server.inject({ method: "GET", url: "/d/keep-the-museum-open" });
    expect(response.statusCode).toBe(200);
    const html = response.body;

    expect(metaContent(html, "og:title")).toBe("Keep the Museum Open");
    expect(metaContent(html, "og:type")).toBe("article");
    // The statement's own first sentence, not the version's changelog line.
    expect(metaContent(html, "og:description")).toBe(
      "The board voted in March to close three galleries.",
    );
    expect(metaContent(html, "og:url")).toBe("https://drafter.example.org/d/keep-the-museum-open");
    expect(metaContent(html, "og:site_name")).toBe("Example Drafter");
    expect(metaContent(html, "og:image")).toBe("https://drafter.example.org/og.png");
    expect(metaContent(html, "twitter:card")).toBe("summary_large_image");
    expect(html).toContain(
      '<link rel="canonical" href="https://drafter.example.org/d/keep-the-museum-open">',
    );
    expect(html).toContain("<title>Keep the Museum Open</title>");
    // A public document is exactly what a crawler should index.
    expect(metaContent(html, "robots")).toBeUndefined();
    // The shell's own script survives the head rewrite.
    expect(html).toContain('<div id="root">');
  });

  it("falls back to the version summary, then the generic line, when the text yields no sentence", async () => {
    const server = await buildShellServer();

    // A body that is all furniture — a heading and a list, no prose line.
    const furniture = "## Gallery Letter\n\n- a list item\n- another list item\n";

    await seedDocument(server, {
      slug: "gallery-letter",
      title: "Gallery Letter",
      public_access: "read",
      body: "## Gallery Letter\n\nA first draft that still had a sentence in it.",
    });
    await server.storage.commit(
      "publish",
      {
        actor: TEST_ACTOR,
        subject: "publish: gallery-letter v2",
        document: "gallery-letter",
        version: 2,
        summary: "Named the three galleries at risk.",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "gallery-letter" }, { body: furniture });
      },
    );

    const summarised = await server.inject({ method: "GET", url: "/d/gallery-letter" });
    expect(metaContent(summarised.body, "og:description")).toBe(
      "Named the three galleries at risk.",
    );

    // Neither source yields anything: the generic instance line.
    await seedDocument(server, {
      slug: "quiet-letter",
      title: "Quiet Letter",
      public_access: "read",
      body: "## Quiet Letter\n\nA first draft that still had a sentence in it.",
    });
    await server.storage.commit(
      "publish",
      {
        actor: TEST_ACTOR,
        subject: "publish: quiet-letter v2",
        document: "quiet-letter",
        version: 2,
        summary: "",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "quiet-letter" }, { body: furniture });
      },
    );

    const generic = await server.inject({ method: "GET", url: "/d/quiet-letter" });
    expect(metaContent(generic.body, "og:description")).toBe(GENERIC_DESCRIPTION);
  });

  it("prefers the first sentence of the text over the version summary", async () => {
    const server = await buildShellServer();

    await seedDocument(server, {
      slug: "neighbours-letter",
      title: "Neighbours Letter",
      public_access: "read",
      body: "## Neighbours Letter\n\n- a list item\n\nWe write as neighbours of the museum. We have three asks.",
    });
    await server.storage.commit(
      "publish",
      {
        actor: TEST_ACTOR,
        subject: "publish: neighbours-letter v2",
        document: "neighbours-letter",
        version: 2,
        summary: "Tightened the second ask.",
      },
      async (tx) => {
        await tx.documents.patch(
          { slug: "neighbours-letter" },
          {
            body: "## Neighbours Letter\n\n- a list item\n\nWe write as **neighbours** of the museum. We have three asks.",
          },
        );
      },
    );

    const response = await server.inject({ method: "GET", url: "/d/neighbours-letter" });
    expect(metaContent(response.body, "og:description")).toBe(
      "We write as neighbours of the museum.",
    );
  });

  it("gives a private slug, an unknown slug, a personal link and admin the generic tags", async () => {
    const server = await buildShellServer();

    // No `public_access`: the gitsheets default is `none`.
    await seedDocument(server, {
      slug: "private-charter",
      title: "Draft Charter Nobody Should See",
      body: "The coalition agrees to the following terms.",
    });
    await seedParticipant(server, {
      document: "private-charter",
      person: "jane-doe",
      token: "z".repeat(20),
    });

    const paths = [
      "/d/private-charter",
      "/d/never-created-at-all",
      `/i/${"z".repeat(20)}`,
      "/admin",
      "/",
    ];

    const heads = new Map<string, string[]>();
    for (const path of paths) {
      const response = await server.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      const html = response.body;

      expect(metaContent(html, "og:title")).toBe("Example Drafter");
      expect(metaContent(html, "og:type")).toBe("website");
      expect(metaContent(html, "og:url")).toBe("https://drafter.example.org");
      expect(html).toContain("<title>Example Drafter</title>");
      // Nothing about the document it may or may not be.
      expect(html).not.toContain("Draft Charter");
      expect(html).not.toContain("private-charter");
      expect(html).not.toContain("coalition agrees");
      heads.set(path, headTags(html));
    }

    // A private document and a slug that was never created preview identically.
    expect(heads.get("/d/private-charter")).toEqual(heads.get("/d/never-created-at-all"));

    // Personal-link and admin pages are nobody's to index; a public page is.
    const response = await server.inject({ method: "GET", url: `/i/${"z".repeat(20)}` });
    expect(metaContent(response.body, "robots")).toBe("noindex, nofollow");
    const admin = await server.inject({ method: "GET", url: "/admin" });
    expect(metaContent(admin.body, "robots")).toBe("noindex, nofollow");
    const root = await server.inject({ method: "GET", url: "/" });
    expect(metaContent(root.body, "robots")).toBeUndefined();
  });
});
