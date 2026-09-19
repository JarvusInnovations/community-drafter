import { afterEach, describe, expect, it } from "bun:test";

import {
  adminHeaders,
  buildTestServer,
  commitCount,
  seedDocument,
  TEST_ACTOR,
} from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("POST /admin/api/documents/:slug/invitations/import", () => {
  it("merges 50 rows with 5 duplicate emails into 45 new + 5 updated people, 50 participations, one commit", async () => {
    const { server, dataDir, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-import" });

    // Pre-seed 5 people who already exist on the instance (but have no
    // participation on this document yet) — these are the "5 duplicate
    // emails" the import batch will match by email, not create anew.
    const preexisting = Array.from({ length: 5 }, (_, i) => ({
      id: `existing-person-${i}`,
      name: `Existing Person ${i}`,
      email: `existing${i}@example.org`,
    }));
    await server.storage.commit(
      "invite",
      { actor: TEST_ACTOR, subject: "invite: pre-seed people" },
      async (tx) => {
        for (const person of preexisting) {
          await tx.people.upsert({ ...person, source: "crm" });
        }
      },
    );

    const rows = [
      ...Array.from({ length: 45 }, (_, i) => ({
        name: `New Person ${i}`,
        email: `new${i}@example.org`,
      })),
      // Same 5 emails as the pre-seeded people, different case to exercise
      // the case-insensitive merge.
      ...preexisting.map((p) => ({ name: p.name, email: p.email.toUpperCase() })),
    ];
    expect(rows.length).toBe(50);

    const before = await commitCount(dataDir);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-import/invitations/import",
      headers: adminHeaders(),
      payload: rows,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      people_created: 45,
      people_updated: 5,
      invitations_created: 50,
      skipped_existing: 0,
      commit: expect.any(String),
    });

    const after = await commitCount(dataDir);
    expect(after - before).toBe(1);

    const invitations = server.storage.readModel.listParticipationsForDocument("doc-import");
    expect(invitations.length).toBe(50);

    await server.close();
  });

  it("skips rows whose participation already exists on this document", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-import-2" });

    const row = { name: "Jane Doe", email: "jane@example.org" };
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-import-2/invitations/import",
      headers: adminHeaders(),
      payload: [row],
    });

    const second = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-import-2/invitations/import",
      headers: adminHeaders(),
      payload: [row],
    });

    const secondBody = JSON.parse(second.body);
    // Re-importing the same row is a no-op patch (identical fields, no new
    // participation) — the underlying commit may collapse to no real tree
    // change, so `commit` can be null here (unlike the first import above).
    expect(secondBody).toEqual({
      people_created: 0,
      people_updated: 1,
      invitations_created: 0,
      skipped_existing: 1,
      commit: secondBody.commit,
    });

    await server.close();
  });
});

describe("GET /admin/api/documents/:slug/invitations", () => {
  it("never contains a token", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-list" });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-list/invitations/import",
      headers: adminHeaders(),
      payload: [{ name: "Jane Doe", email: "jane@example.org" }],
    });

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-list/invitations",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);

    const participation = server.storage.readModel.getParticipation("doc-list", "jane-doe");
    const token = participation?.record.token as string;
    expect(token).toBeTruthy();

    // The regex-over-the-response assertion `plans/api-core.md` names: no
    // token-shaped substring (16+ base62 chars) appears anywhere, and
    // specifically the real minted token never appears.
    expect(response.body.includes(token)).toBe(false);
    expect(response.body).not.toMatch(/[A-Za-z0-9]{16,}/);

    await server.close();
  });
});

describe("POST /admin/api/documents/:slug/invitations/links", () => {
  it("returns a CSV of tokens and records an activity entry with the export count", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-links" });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-links/invitations/import",
      headers: adminHeaders(),
      payload: [{ name: "Jane Doe", email: "jane@example.org" }],
    });

    const participation = server.storage.readModel.getParticipation("doc-links", "jane-doe");
    const token = participation?.record.token as string;

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-links/invitations/links",
      headers: adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.body).toContain("person,name,email,link");
    expect(response.body).toContain(token);

    const activity = server.storage.readModel.getDocument("doc-links")?.activity ?? [];
    const exportEntry = activity.find((entry) => entry.action === "link-export");
    expect(exportEntry).toBeDefined();
    expect(exportEntry?.subject).toContain("1 tokens");

    await server.close();
  });
});
