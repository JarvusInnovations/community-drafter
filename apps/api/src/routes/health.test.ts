import { describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";

describe("GET /_health", () => {
  it("responds healthy", async () => {
    process.env.NODE_ENV = "test";
    const server = Fastify();
    await server.register(app);
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/_health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("healthy");

    await server.close();
  });
});
