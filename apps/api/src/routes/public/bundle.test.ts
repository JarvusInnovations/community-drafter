import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function signAs(
  server: Awaited<ReturnType<typeof buildTestServer>>["server"],
  document: string,
  person: string,
): Promise<void> {
  await server.storage.commit(
    "sign",
    {
      actor: { kind: "participant" },
      subject: `sign: ${person} on ${document}`,
      document,
      person,
      version: 1,
    },
    async (tx) => {
      await tx.participations.patch(
        { document, person },
        {
          signature: {
            capacity: "personal",
            display_name: `Display ${person}`,
            authorized: true,
            listed: true,
            display_approved: true,
            signed_on_version: 1,
          },
        },
      );
    },
  );
}

describe("GET /d/:slug/api/bundle", () => {
  it("carries document/version/versions/signatories but no person-specific fields", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-public-bundle",
      public_access: "read",
      body: "Version one text.",
      reply_to: "team@example.org",
      show_signatories: "list",
    });
    await seedParticipant(server, {
      document: "doc-public-bundle",
      person: "jane-doe",
      token: "z".repeat(20),
      email: "jane@example.org",
    });
    await signAs(server, "doc-public-bundle", "jane-doe");

    const response = await server.inject({
      method: "GET",
      url: "/d/doc-public-bundle/api/bundle",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.document).toMatchObject({
      slug: "doc-public-bundle",
      reply_to: "team@example.org",
      show_signatories: "list",
    });
    expect(body.version.html).toContain("Version one text");
    expect(Array.isArray(body.versions)).toBe(true);
    expect(body.signatories.individuals).toBe(1);
    expect(body.signatories.list[0].display_name).toBe("Display jane-doe");

    // No participant token, email, or per-person fields anywhere in the body.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("z".repeat(20));
    expect(raw).not.toMatch(/jane@example\.org/u);
    expect(body.person).toBeUndefined();
    expect(body.signature).toBeUndefined();
    expect(body.submissions).toBeUndefined();
    expect(body.prefill).toBeUndefined();
    expect(body.notify).toBeUndefined();

    await server.close();
  });

  it("supports ?v= for an older version's text", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-public-versions",
      public_access: "read",
      body: "First text.",
    });

    await server.storage.commit(
      "publish",
      {
        actor: { kind: "admin", email: "team@example.org" },
        subject: "publish v2",
        document: "doc-public-versions",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "doc-public-versions" }, { body: "Second text." });
      },
    );

    const v1 = await server.inject({ method: "GET", url: "/d/doc-public-versions/api/bundle?v=1" });
    expect(v1.statusCode).toBe(200);
    expect(v1.json().version.html).toContain("First text");
    expect(v1.json().version.is_current).toBe(false);

    const current = await server.inject({
      method: "GET",
      url: "/d/doc-public-versions/api/bundle",
    });
    expect(current.json().version.html).toContain("Second text");
    expect(current.json().version.is_current).toBe(true);

    await server.close();
  });
});
