import { afterEach, describe, expect, it } from "bun:test";

import { mintOperatorToken } from "../../auth/tokens.ts";
import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  TEST_ACTOR,
  TEST_AUTH_SECRET,
} from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function bearerFor(server: import("fastify").FastifyInstance, email: string) {
  const operator = server.storage.readModel.getOperatorByEmail(email);
  const minted = await mintOperatorToken({
    purpose: "cli",
    email,
    name: operator?.name ?? email,
    kind: operator?.kind ?? "person",
    secret: TEST_AUTH_SECRET,
  });
  return { authorization: `Bearer ${minted.token}` };
}

describe("GET /admin/api/operators", () => {
  it("lists every operator, including ones added by another operator", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "second@example.org", name: "Second Op" },
    });

    const list = await server.inject({
      method: "GET",
      url: "/admin/api/operators",
      headers: adminHeaders(),
    });
    expect(list.statusCode).toBe(200);
    const emails = list.json<Array<{ email: string }>>().map((o) => o.email);
    expect(emails).toContain(TEST_ACTOR.email);
    expect(emails).toContain("second@example.org");

    await server.close();
  });
});

describe("POST /admin/api/operators", () => {
  it("creates an operator (Action: operator-add), 409s a duplicate email", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const create = await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "Bot@Example.org", name: "A Bot", kind: "bot" },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json();
    expect(body.email).toBe("bot@example.org");
    expect(body.kind).toBe("bot");
    expect(body.active).toBe(true);

    const dupe = await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "bot@example.org", name: "Duplicate" },
    });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error).toBe("already_exists");

    await server.close();
  });
});

describe("PATCH /admin/api/operators/:email", () => {
  it("updates fields, and refuses self-deactivation (422)", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const selfDeactivate = await server.inject({
      method: "PATCH",
      url: `/admin/api/operators/${TEST_ACTOR.email}`,
      headers: adminHeaders(),
      payload: { active: false },
    });
    expect(selfDeactivate.statusCode).toBe(422);

    const rename = await server.inject({
      method: "PATCH",
      url: `/admin/api/operators/${TEST_ACTOR.email}`,
      headers: adminHeaders(),
      payload: { title: "Coalition Lead" },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().title).toBe("Coalition Lead");

    await server.close();
  });

  it("a different operator CAN deactivate you (self-check is only about the caller)", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "colleague@example.org", name: "Colleague" },
    });
    const colleagueAuth = await bearerFor(server, "colleague@example.org");

    const response = await server.inject({
      method: "PATCH",
      url: `/admin/api/operators/${TEST_ACTOR.email}`,
      headers: colleagueAuth,
      payload: { active: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().active).toBe(false);

    await server.close();
  });
});

describe("DELETE /admin/api/operators/:email", () => {
  it("removes the operator and drops them from every document's operators list, in one commit", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "leaving@example.org", name: "Leaving" },
    });
    await seedDocument(server, {
      slug: "shared-doc",
      operators: [TEST_ACTOR.email, "leaving@example.org"],
    });

    const remove = await server.inject({
      method: "DELETE",
      url: "/admin/api/operators/leaving@example.org",
      headers: adminHeaders(),
    });
    expect(remove.statusCode).toBe(200);

    expect(server.storage.readModel.getOperatorByEmail("leaving@example.org")).toBeUndefined();
    expect(server.storage.readModel.getDocument("shared-doc")?.record.operators).toEqual([
      TEST_ACTOR.email,
    ]);

    await server.close();
  });

  it("409 last_operator when removal would leave a document with none", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "sole@example.org", name: "Sole Operator" },
    });
    await seedDocument(server, { slug: "sole-doc", operators: ["sole@example.org"] });

    const remove = await server.inject({
      method: "DELETE",
      url: "/admin/api/operators/sole@example.org",
      headers: adminHeaders(),
    });
    expect(remove.statusCode).toBe(409);
    expect(remove.json().error).toBe("last_operator");
    expect(server.storage.readModel.getOperatorByEmail("sole@example.org")).toBeDefined();

    await server.close();
  });
});

describe("GET /admin/api/documents scoping", () => {
  it("returns only the caller's documents", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "other@example.org", name: "Other Op" },
    });
    await seedDocument(server, { slug: "mine", operators: [TEST_ACTOR.email] });
    await seedDocument(server, { slug: "theirs", operators: ["other@example.org"] });

    const mine = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: adminHeaders(),
    });
    const slugs = mine.json<Array<{ slug: string }>>().map((d) => d.slug);
    expect(slugs).toContain("mine");
    expect(slugs).not.toContain("theirs");

    const otherAuth = await bearerFor(server, "other@example.org");
    const theirs = await server.inject({
      method: "GET",
      url: "/admin/api/documents",
      headers: otherAuth,
    });
    const otherSlugs = theirs.json<Array<{ slug: string }>>().map((d) => d.slug);
    expect(otherSlugs).toContain("theirs");
    expect(otherSlugs).not.toContain("mine");

    await server.close();
  });
});

describe("document operators sub-resource", () => {
  it("GET/POST/DELETE .../documents/:slug/operators", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "co-op@example.org", name: "Co-Op" },
    });
    await seedDocument(server, { slug: "co-doc", operators: [TEST_ACTOR.email] });

    const add = await server.inject({
      method: "POST",
      url: "/admin/api/documents/co-doc/operators",
      headers: adminHeaders(),
      payload: { email: "co-op@example.org" },
    });
    expect(add.statusCode).toBe(200);

    const list = await server.inject({
      method: "GET",
      url: "/admin/api/documents/co-doc/operators",
      headers: adminHeaders(),
    });
    const emails = list.json<Array<{ email: string }>>().map((o) => o.email);
    expect(emails).toContain("co-op@example.org");
    expect(emails).toContain(TEST_ACTOR.email);

    // 422 adding an unknown/inactive operator.
    const badAdd = await server.inject({
      method: "POST",
      url: "/admin/api/documents/co-doc/operators",
      headers: adminHeaders(),
      payload: { email: "not-an-operator@example.org" },
    });
    expect(badAdd.statusCode).toBe(422);

    // Removing down to one operator is fine; removing the last is refused.
    const removeCoOp = await server.inject({
      method: "DELETE",
      url: "/admin/api/documents/co-doc/operators/co-op@example.org",
      headers: adminHeaders(),
    });
    expect(removeCoOp.statusCode).toBe(200);

    const removeLast = await server.inject({
      method: "DELETE",
      url: `/admin/api/documents/co-doc/operators/${TEST_ACTOR.email}`,
      headers: adminHeaders(),
    });
    expect(removeLast.statusCode).toBe(409);
    expect(removeLast.json().error).toBe("last_operator");

    await server.close();
  });

  it("a caller who isn't on the document gets 404, not 403", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "outsider@example.org", name: "Outsider" },
    });
    await seedDocument(server, { slug: "private-doc", operators: [TEST_ACTOR.email] });
    const outsiderAuth = await bearerFor(server, "outsider@example.org");

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/private-doc/operators",
      headers: outsiderAuth,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");

    await server.close();
  });
});
