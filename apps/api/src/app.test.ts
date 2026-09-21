import { afterEach, describe, expect, it } from "bun:test";

import { adminHeaders, buildTestServer, seedDocument } from "./routes/test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * `specs/api/conventions.md` § Responses: a request the server rejects
 * before any handler runs is still the caller's mistake, so it keeps the
 * status the framework gave it instead of collapsing to `internal_error`.
 */
describe("error envelope — framework-raised 4xx", () => {
  it("reports an empty JSON body as 400 invalid_request, naming the parse failure", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-envelope" });

    const response = await server.inject({
      method: "DELETE",
      url: "/admin/api/documents/doc-envelope/operators/someone@example.org",
      headers: { ...adminHeaders(), "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe("invalid_request");
    expect(body.details.code).toBe("FST_ERR_CTP_EMPTY_JSON_BODY");
    expect(body.message).not.toBe("Something went wrong.");
  });

  it("reports a malformed JSON body as 400 invalid_request", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-envelope-2" });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-envelope-2/close",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      payload: "{ not json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
  });
});
