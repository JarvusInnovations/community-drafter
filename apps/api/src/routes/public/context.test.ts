import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, seedDocument } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * `specs/screens/public-and-embed.md`: "All 404 when `public_access =
 * none`, `state = draft`, or the slug is unknown, with the same body."
 * `plans/public-and-embed.md` § Validation: "`/d/<slug>` 404s when
 * `public_access = none` or `state = draft`, with the same body as an
 * unknown slug." Checked against `GET /d/:slug/api/bundle` — every other
 * `/d/:slug/*` route shares `loadPublicDocument` (`./context.ts`), so this
 * one route stands for all of them.
 */
describe("public 404 parity", () => {
  it("returns the identical body for public_access=none, state=draft, and an unknown slug", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-private", public_access: "none" });
    await seedDocument(server, { slug: "doc-draft", state: "draft", public_access: "read" });

    const [privateRes, draftRes, unknownRes] = await Promise.all([
      server.inject({ method: "GET", url: "/d/doc-private/api/bundle" }),
      server.inject({ method: "GET", url: "/d/doc-draft/api/bundle" }),
      server.inject({ method: "GET", url: "/d/does-not-exist/api/bundle" }),
    ]);

    expect(privateRes.statusCode).toBe(404);
    expect(draftRes.statusCode).toBe(404);
    expect(unknownRes.statusCode).toBe(404);

    expect(privateRes.json()).toEqual(draftRes.json());
    expect(privateRes.json()).toEqual(unknownRes.json());

    await server.close();
  });

  it("also 404s the same way for signatories.json and widget.js", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-hidden", public_access: "none" });

    const bundleRes = await server.inject({ method: "GET", url: "/d/doc-hidden/api/bundle" });
    const signatoriesRes = await server.inject({
      method: "GET",
      url: "/d/doc-hidden/signatories.json",
    });
    const widgetRes = await server.inject({ method: "GET", url: "/d/doc-hidden/widget.js" });

    expect(signatoriesRes.statusCode).toBe(404);
    expect(widgetRes.statusCode).toBe(404);
    expect(signatoriesRes.json()).toEqual(bundleRes.json());
    expect(widgetRes.json()).toEqual(bundleRes.json());

    await server.close();
  });

  it("serves a document with public_access=read and state=open", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-public",
      public_access: "read",
      body: "Public text.",
    });

    const response = await server.inject({ method: "GET", url: "/d/doc-public/api/bundle" });
    expect(response.statusCode).toBe(200);
    expect(response.json().document.slug).toBe("doc-public");

    await server.close();
  });
});
