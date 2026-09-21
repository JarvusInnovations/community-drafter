import { afterEach, describe, expect, it } from "bun:test";

import { mintOperatorToken } from "../../auth/tokens.ts";
import { FakeMailer } from "../../lib/mailer/index.ts";
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

  it("superadmin: only a superadmin may grant it, never on themself; the grantee can then grant", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    for (const email of ["alpha@example.org", "bravo@example.org"]) {
      await server.inject({
        method: "POST",
        url: "/admin/api/operators",
        headers: adminHeaders(),
        payload: { email, name: email },
      });
    }
    const aAuth = await bearerFor(server, "alpha@example.org");

    const byPlain = await server.inject({
      method: "PATCH",
      url: "/admin/api/operators/bravo@example.org",
      headers: aAuth,
      payload: { superadmin: true },
    });
    expect(byPlain.statusCode).toBe(403);
    expect(byPlain.json().error).toBe("forbidden");

    const onSelf = await server.inject({
      method: "PATCH",
      url: `/admin/api/operators/${TEST_ACTOR.email}`,
      headers: adminHeaders(),
      payload: { superadmin: false },
    });
    expect(onSelf.statusCode).toBe(422);

    const grant = await server.inject({
      method: "PATCH",
      url: "/admin/api/operators/alpha@example.org",
      headers: adminHeaders(),
      payload: { superadmin: true },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().superadmin).toBe(true);

    const byNewSuperadmin = await server.inject({
      method: "PATCH",
      url: "/admin/api/operators/bravo@example.org",
      headers: aAuth,
      payload: { superadmin: true },
    });
    expect(byNewSuperadmin.statusCode).toBe(200);

    const list = await server.inject({
      method: "GET",
      url: "/admin/api/operators",
      headers: aAuth,
    });
    const flags = Object.fromEntries(
      list
        .json<Array<{ email: string; superadmin: boolean }>>()
        .map((o) => [o.email, o.superadmin]),
    );
    expect(flags["alpha@example.org"]).toBe(true);
    expect(flags["bravo@example.org"]).toBe(true);

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
    // The bootstrap operator is a superadmin and therefore sees every document.
    expect(slugs).toContain("mine");
    expect(slugs).toContain("theirs");

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

/** `specs/behaviors/notifications.md` § Messages + § Operator mail. */
describe("operator mail", () => {
  it("operator-added tells the new operator the instance, who added them and where to sign in", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({
      mailer,
      env: { INSTANCE_NAME: "Save the Academy", PUBLIC_URL: "https://drafter.example.org" },
    });
    cleanups.push(cleanup);

    const create = await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "newcomer@example.org", name: "Nina Newcomer" },
    });
    expect(create.statusCode).toBe(201);

    const message = mailer.sent.find((m) => m.to.email === "newcomer@example.org");
    expect(message).toBeDefined();
    expect(message!.subject).toBe("You're an operator on Save the Academy");
    expect(message!.text).toContain("Hi Nina,");
    // The instance, who did it, the sign-in address, and that there is no password.
    expect(message!.text).toContain("Save the Academy");
    expect(message!.text).toContain(TEST_ACTOR.email);
    expect(message!.text).toContain("https://drafter.example.org/admin");
    expect(message!.text).toContain("There is no password");
    // An operator message carries no personal-link token and no preference
    // links — `specs/behaviors/notifications.md` § Operator mail, which the
    // participant-wide footer rule in § Content rules does not reach.
    expect(message!.text).not.toContain("/i/");
    expect(message!.text).not.toContain("Manage how we contact you");
    expect(message!.text).not.toContain("Stop optional messages");
    expect(message!.text).not.toContain("/prefs");
    expect(message!.html).not.toContain("/prefs");
    expect(message!.personalLink).toBeUndefined();

    // An actor whose record carries a name is named, not emailed at.
    mailer.sent.length = 0;
    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: await bearerFor(server, "newcomer@example.org"),
      payload: { email: "third@example.org", name: "Theo Third" },
    });
    const second = mailer.sent.find((m) => m.to.email === "third@example.org");
    expect(second).toBeDefined();
    expect(second!.text).toContain("Nina Newcomer added you as an operator");

    await server.close();
  });

  it("operator-added-to-document names the document and links its dashboard", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({
      mailer,
      env: { INSTANCE_NAME: "Save the Academy", PUBLIC_URL: "https://drafter.example.org" },
    });
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "colleague@example.org", name: "Cass Colleague" },
    });
    await seedDocument(server, {
      slug: "mail-doc",
      title: "Coalition Charter",
      operators: [TEST_ACTOR.email],
    });
    mailer.sent.length = 0;

    const add = await server.inject({
      method: "POST",
      url: "/admin/api/documents/mail-doc/operators",
      headers: adminHeaders(),
      payload: { email: "colleague@example.org" },
    });
    expect(add.statusCode).toBe(200);

    const message = mailer.sent.find((m) => m.to.email === "colleague@example.org");
    expect(message).toBeDefined();
    expect(message!.subject).toBe("Coalition Charter — you were added as an operator");
    expect(message!.text).toContain("Hi Cass,");
    expect(message!.text).toContain("Coalition Charter");
    expect(message!.text).toContain(TEST_ACTOR.email);
    expect(message!.text).toContain("https://drafter.example.org/admin/d/mail-doc");

    // Adding someone already on the document changes nothing and mails nobody.
    mailer.sent.length = 0;
    const again = await server.inject({
      method: "POST",
      url: "/admin/api/documents/mail-doc/operators",
      headers: adminHeaders(),
      payload: { email: "colleague@example.org" },
    });
    expect(again.json().added).toBe(false);
    expect(mailer.sent).toHaveLength(0);

    await server.close();
  });

  it("never mails the operator about their own action", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);

    // The bootstrap operator is a superadmin, so they can add themselves to
    // a document they don't run — the one reachable self-add.
    await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "owner@example.org", name: "Olive Owner" },
    });
    await seedDocument(server, { slug: "someone-elses", operators: ["owner@example.org"] });
    mailer.sent.length = 0;

    const add = await server.inject({
      method: "POST",
      url: "/admin/api/documents/someone-elses/operators",
      headers: adminHeaders(),
      payload: { email: TEST_ACTOR.email },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().added).toBe(true);
    expect(mailer.sent).toHaveLength(0);

    await server.close();
  });

  it("a mailer that refuses does not fail the action that was already committed", async () => {
    const mailer = new FakeMailer();
    mailer.failNextFor("unreachable@example.org", 5);
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);

    const create = await server.inject({
      method: "POST",
      url: "/admin/api/operators",
      headers: adminHeaders(),
      payload: { email: "unreachable@example.org", name: "Una Unreachable" },
    });
    expect(create.statusCode).toBe(201);
    expect(server.storage.readModel.getOperatorByEmail("unreachable@example.org")).toBeDefined();

    await server.close();
  });
});
