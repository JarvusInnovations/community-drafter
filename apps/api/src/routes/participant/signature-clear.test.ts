import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

type TestServer = Awaited<ReturnType<typeof buildTestServer>>["server"];

const TOKEN = "c".repeat(20);

async function openDocument(server: TestServer, slug: string): Promise<void> {
  await seedDocument(server, {
    slug,
    body: "Version one text.",
    comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
    signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
  });
  await seedParticipant(server, { document: slug, person: "jane-doe", token: TOKEN });
}

async function sign(server: TestServer, payload: Record<string, unknown>): Promise<void> {
  const response = await server.inject({
    method: "POST",
    url: `/i/${TOKEN}/api/signature`,
    payload,
  });
  expect(response.statusCode).toBe(200);
}

async function patch(server: TestServer, payload: Record<string, unknown>) {
  return server.inject({ method: "PATCH", url: `/i/${TOKEN}/api/signature`, payload });
}

function stored(server: TestServer, slug: string): Record<string, unknown> | undefined {
  return server.storage.readModel.getParticipation(slug, "jane-doe")?.record.signature as
    | Record<string, unknown>
    | undefined;
}

/**
 * `specs/api/participant.md` § `PATCH /i/:token/api/signature` and
 * `specs/behaviors/signatures.md` § Changing how a signature is listed:
 * omitted = unchanged; present and blank after trimming = cleared (issue
 * #116 — emptying the descriptor kept the old one).
 */
describe("PATCH /signature — emptying a field clears it", () => {
  it("an empty descriptor removes the stored one", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-clear");
    await sign(server, {
      capacity: "personal",
      display_name: "Jane Doe",
      descriptor: "Neighbor",
    });

    const response = await patch(server, { display_name: "Jane Doe", descriptor: "" });
    expect(response.statusCode).toBe(200);
    expect(response.json().descriptor).toBeUndefined();
    expect(stored(server, "doc-clear")).not.toHaveProperty("descriptor");

    await server.close();
  });

  it("a whitespace-only descriptor clears it too, and saved values are trimmed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-clear-ws");
    await sign(server, { capacity: "personal", display_name: "Jane Doe", descriptor: "Neighbor" });

    const cleared = await patch(server, { descriptor: "   " });
    expect(cleared.statusCode).toBe(200);
    expect(stored(server, "doc-clear-ws")).not.toHaveProperty("descriptor");

    const renamed = await patch(server, { display_name: "  Jane A. Doe  " });
    expect(renamed.statusCode).toBe(200);
    expect(stored(server, "doc-clear-ws")?.display_name).toBe("Jane A. Doe");

    await server.close();
  });

  it("an omitted descriptor is left as it was", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-omit");
    await sign(server, { capacity: "personal", display_name: "Jane Doe", descriptor: "Neighbor" });

    const response = await patch(server, { display_name: "Jane A. Doe" });
    expect(response.statusCode).toBe(200);
    expect(stored(server, "doc-omit")).toMatchObject({
      display_name: "Jane A. Doe",
      descriptor: "Neighbor",
    });

    await server.close();
  });

  it("refuses a blank name rather than clearing it", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-blank-name");
    await sign(server, { capacity: "personal", display_name: "Jane Doe" });

    const response = await patch(server, { display_name: "  " });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: "validation_failed",
      details: { field: "display_name" },
    });
    expect(stored(server, "doc-blank-name")?.display_name).toBe("Jane Doe");

    await server.close();
  });

  it("refuses a blank official title or organization", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-blank-official");
    await sign(server, {
      capacity: "official",
      display_name: "Jane Doe",
      org: "River Alliance",
      title: "Chair",
      authorized: true,
    });

    const title = await patch(server, { title: " " });
    expect(title.statusCode).toBe(422);
    expect(title.json()).toMatchObject({ error: "validation_failed", details: { field: "title" } });

    const org = await patch(server, { org: "", authorized: true });
    expect(org.statusCode).toBe(422);
    expect(org.json()).toMatchObject({ error: "validation_failed", details: { field: "org" } });

    expect(stored(server, "doc-blank-official")).toMatchObject({
      org: "River Alliance",
      title: "Chair",
    });

    await server.close();
  });
});
