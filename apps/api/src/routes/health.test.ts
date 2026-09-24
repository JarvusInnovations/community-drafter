import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { createTestDataRepo } from "../storage/test-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("GET /_health", () => {
  it("responds healthy and reports storage readiness", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const server = Fastify();
    await server.register(app, { storage: { dataDir, trackerIntervalMs: 3_600_000 } });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/_health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("healthy");
    expect(body.storage.ready).toBe(true);
    expect(body.storage.documents).toBe(0);
    expect(body.storage.push).toBeNull(); // no 'origin' remote configured in this fixture

    await server.close();
  });
});
