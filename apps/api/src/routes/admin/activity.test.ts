import { afterEach, describe, expect, it } from "bun:test";

import { adminHeaders, buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("GET /admin/api/documents/:slug/activity", () => {
  it("returns parsed trailers for the document's commits, newest first", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-activity", body: "v1 text." });
    await seedParticipant(server, {
      document: "doc-activity",
      person: "jane-doe",
      token: "h".repeat(20),
    });
    await server.storage.commit(
      "sign",
      {
        actor: { kind: "participant" },
        subject: "sign: jane-doe on doc-activity",
        document: "doc-activity",
        person: "jane-doe",
        version: 1,
        reason: undefined,
      },
      async (tx) => {
        await tx.participations.patch(
          { document: "doc-activity", person: "jane-doe" },
          {
            signature: {
              capacity: "personal",
              display_name: "Jane Doe",
              authorized: true,
              listed: true,
              signed_on_version: 1,
              revoked: false,
            },
          },
        );
      },
    );
    await server.storage.commit(
      "revoke",
      {
        actor: { kind: "participant" },
        subject: "revoke: jane-doe on doc-activity",
        document: "doc-activity",
        person: "jane-doe",
        reason: "changed my mind",
      },
      async (tx) => {
        await tx.participations.patch(
          { document: "doc-activity", person: "jane-doe" },
          {
            signature: {
              capacity: "personal",
              display_name: "Jane Doe",
              authorized: true,
              listed: true,
              signed_on_version: 1,
              revoked: true,
            },
          },
        );
      },
    );

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-activity/activity",
      headers: adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const entries = response.json() as Array<Record<string, unknown>>;
    expect(entries.map((e) => e.action)).toEqual(["revoke", "sign", "invite", "create"]);
    expect(entries[0]).toMatchObject({
      action: "revoke",
      person: "jane-doe",
      reason: "changed my mind",
      actor: "participant",
    });
    expect(entries[0]?.commit).toBeTruthy();
    expect(entries[0]?.date).toBeTruthy();

    await server.close();
  });

  it("filters by person", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-activity-2" });
    await seedParticipant(server, {
      document: "doc-activity-2",
      person: "jane-doe",
      token: "i".repeat(20),
    });
    await seedParticipant(server, {
      document: "doc-activity-2",
      person: "john-roe",
      token: "j".repeat(20),
    });

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-activity-2/activity?person=jane-doe",
      headers: adminHeaders(),
    });
    const entries = response.json() as Array<Record<string, unknown>>;
    expect(entries.every((e) => e.person === undefined || e.person === "jane-doe")).toBe(true);

    await server.close();
  });
});
