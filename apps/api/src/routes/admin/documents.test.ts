import { afterEach, describe, expect, it } from "bun:test";

import { adminHeaders, buildTestServer, seedDocument } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("POST /admin/api/documents/:slug/schedule", () => {
  it("returns deadline_not_later when the new time isn't later", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const commentsCloseAt = new Date(Date.now() + 3_600_000).toISOString();
    const signingClosesAt = new Date(Date.now() + 7_200_000).toISOString();
    await seedDocument(server, {
      slug: "doc-schedule",
      comments_close_at: commentsCloseAt,
      signing_closes_at: signingClosesAt,
    });

    const earlier = new Date(Date.now() + 1_000).toISOString();
    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-schedule/schedule",
      headers: adminHeaders(),
      payload: { comments_close_at: earlier },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("deadline_not_later");

    // A genuinely later time succeeds (still before signing_closes_at).
    const later = new Date(Date.now() + 5_400_000).toISOString();
    const okResponse = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-schedule/schedule",
      headers: adminHeaders(),
      payload: { comments_close_at: later },
    });
    expect(okResponse.statusCode).toBe(200);
    expect(okResponse.json().comments_close_at).toBe(later);

    await server.close();
  });
});

describe("POST /admin/api/documents/:slug/open", () => {
  it("refuses to open a document with no published version", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-empty",
        title: "Doc Empty",
        owner: "team",
        sender_name: "Team",
        reply_to: "team@example.org",
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-empty/open",
      headers: adminHeaders(),
      payload: {
        comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
        signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("no_version");

    await server.close();
  });

  it("opens once a version exists and queues invitations for pending participations", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-ready",
        title: "Doc Ready",
        owner: "team",
        sender_name: "Team",
        reply_to: "team@example.org",
      },
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-ready/versions",
      headers: adminHeaders(),
      payload: { body: "Initial text.", summary: "Initial draft" },
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-ready/invitations/import",
      headers: adminHeaders(),
      payload: [{ name: "Jane Doe", email: "jane@example.org" }],
    });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-ready/open",
      headers: adminHeaders(),
      payload: {
        comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
        signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("open");

    const participation = server.storage.readModel.getParticipation("doc-ready", "jane-doe");
    expect(participation?.record.sent_at).toBeTruthy();
    expect(participation?.record.notified?.invitation).toBeTruthy();

    await server.close();
  });
});
