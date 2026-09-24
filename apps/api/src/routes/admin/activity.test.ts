import { afterEach, describe, expect, it } from "bun:test";

import {
  TEST_ACTOR,
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedParticipant,
} from "../test-support.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
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

  /**
   * `specs/behaviors/operators.md` § Superadmins + `specs/screens/admin-dashboard.md`
   * § "Recent activity" (#66): a write by an account outside the document's
   * own operator list is otherwise indistinguishable from an unauthorized
   * one, so a superadmin acting with standing is labeled.
   */
  it("labels an actor who is a superadmin and not one of the document's operators", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    // Owned by someone else entirely; the bootstrap operator (TEST_ACTOR) is
    // a superadmin and is not on it, but can still act.
    await seedDocument(server, {
      slug: "doc-superadmin",
      operators: ["owner@example.org"],
      created_by: "owner@example.org",
    });
    await server.storage.commit(
      "link-export",
      {
        actor: { kind: "operator", email: TEST_ACTOR.email },
        subject: "link-export: 1 tokens for doc-superadmin",
        document: "doc-superadmin",
      },
      async (tx) => {
        await tx.participations.upsert({
          document: "doc-superadmin",
          person: "jane-doe",
          token: "k".repeat(20),
          source: "crm",
        });
      },
    );

    await server.storage.commit(
      "settings",
      {
        actor: { kind: "operator", email: "owner@example.org" },
        subject: "settings: doc-superadmin",
        document: "doc-superadmin",
      },
      async (tx) => {
        await tx.documents.patch({ slug: "doc-superadmin" }, { title: "Renamed by its owner" });
      },
    );

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-superadmin/activity",
      headers: adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const entries = response.json() as Array<Record<string, unknown>>;
    const exported = entries.find((e) => e.action === "link-export");
    expect(exported).toMatchObject({ actor: TEST_ACTOR.email, actor_superadmin: true });

    // The document's own operator carries no label.
    const settings = entries.find((e) => e.action === "settings");
    expect(settings).toMatchObject({ actor: "owner@example.org" });
    expect(settings?.actor_superadmin).toBeUndefined();

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

  /**
   * `specs/screens/admin-dashboard.md` § Recent activity: a person's first
   * visit is an entry, and a return visit is not.
   */
  it("shows a first open as an `opened` entry, and shows nothing for a return visit", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-opens" });
    await seedParticipant(server, {
      document: "doc-opens",
      person: "jane-doe",
      token: "k".repeat(20),
    });

    server.storage.tracker.record("doc-opens", "jane-doe");
    await server.storage.tracker.flush();

    const read = async (): Promise<Array<Record<string, unknown>>> => {
      const response = await server.inject({
        method: "GET",
        url: "/admin/api/documents/doc-opens/activity",
        headers: adminHeaders(),
      });
      return response.json() as Array<Record<string, unknown>>;
    };

    const opens = (await read()).filter((entry) => entry.action === "opened");
    expect(opens.length).toBe(1);
    expect(opens[0]?.person).toBe("jane-doe");

    // The same person again: tracked, but not an event.
    server.storage.tracker.record("doc-opens", "jane-doe");
    await server.storage.tracker.flush();
    const after = await read();
    expect(after.filter((entry) => entry.action === "opened").length).toBe(1);
    expect(after.some((entry) => entry.action === "track")).toBe(false);

    await server.close();
  });
});
