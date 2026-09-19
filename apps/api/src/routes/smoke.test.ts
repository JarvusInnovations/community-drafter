import { afterEach, describe, expect, it } from "bun:test";

import { adminHeaders, buildTestServer, seedDocument, seedParticipant } from "./test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("participant prefs", () => {
  it("GET/PUT prefs, and stop-optional turns off every non-forced toggle", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-prefs",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-prefs",
      person: "jane-doe",
      token: "p".repeat(20),
    });
    const url = `/i/${"p".repeat(20)}/api/prefs`;

    const initial = await server.inject({ method: "GET", url });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      channel: "email",
      phase_changes: true,
      reminders: true,
    });

    const put = await server.inject({
      method: "PUT",
      url,
      payload: { every_revision: true, reminders: false },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().every_revision).toBe(true);
    expect(put.json().reminders).toBe(false);

    const stop = await server.inject({ method: "POST", url: `${url}/stop-optional` });
    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toMatchObject({
      every_revision: false,
      daily_digest: false,
      my_comments_addressed: false,
      reminders: false,
    });

    await server.close();
  });
});

describe("participant versions and compare", () => {
  it("serves a version by number and a compare between two versions", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-versions", body: "# Title\n\nFirst paragraph." });
    await seedParticipant(server, {
      document: "doc-versions",
      person: "jane-doe",
      token: "q".repeat(20),
    });

    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-versions/versions",
      headers: adminHeaders(),
      payload: { body: "# Title\n\nRevised paragraph.", summary: "Revised the paragraph" },
    });

    const v1 = await server.inject({ method: "GET", url: `/i/${"q".repeat(20)}/api/versions/1` });
    expect(v1.statusCode).toBe(200);
    expect(v1.json().html).toContain("First paragraph");

    const compare = await server.inject({
      method: "GET",
      url: `/i/${"q".repeat(20)}/api/compare?from=1&to=2`,
    });
    expect(compare.statusCode).toBe(200);
    const { summary, blocks } = compare.json();
    expect(summary.changed + summary.added + summary.removed).toBeGreaterThan(0);
    expect(blocks.some((b: { status: string }) => b.status !== "same")).toBe(true);

    await server.close();
  });
});

describe("participant decline", () => {
  it("creates an empty submitted submission and revokes any signature", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-decline",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-decline",
      person: "jane-doe",
      token: "r".repeat(20),
    });

    await server.inject({
      method: "POST",
      url: `/i/${"r".repeat(20)}/api/signature`,
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    const decline = await server.inject({
      method: "POST",
      url: `/i/${"r".repeat(20)}/api/decline`,
      payload: { reason: "no longer relevant" },
    });
    expect(decline.statusCode).toBe(200);
    expect(decline.json().declined_at).toBeTruthy();

    const participation = server.storage.readModel.getParticipation("doc-decline", "jane-doe");
    expect(participation?.record.signature?.revoked).toBe(true);
    const position = server.storage.readModel.getPosition("doc-decline", "jane-doe");
    expect(position?.judgement).toBe("decline");

    await server.close();
  });
});

describe("Idempotency-Key replay", () => {
  it("returns the same result for a repeated key without re-committing", async () => {
    const { server, dataDir, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-idem",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-idem",
      person: "jane-doe",
      token: "s".repeat(20),
    });

    const { commitCount } = await import("./test-support.ts");
    const before = await commitCount(dataDir);

    const headers = { "idempotency-key": "retry-key-1" };
    const first = await server.inject({
      method: "POST",
      url: `/i/${"s".repeat(20)}/api/signature`,
      headers,
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });
    const second = await server.inject({
      method: "POST",
      url: `/i/${"s".repeat(20)}/api/signature`,
      headers,
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);

    // One real execution now makes two commits — `sign` itself, plus the
    // `notifications` plan's `send` commit marking
    // `notified.signature-confirmation-<ts>` for the confirmation email
    // (`specs/behaviors/notifications.md` § Sending). What this test
    // guards is that the *replay* added zero more; a re-run would be 4.
    const after = await commitCount(dataDir);
    expect(after - before).toBe(2);

    await server.close();
  });
});

describe("admin signatures, submissions, notifications and instance", () => {
  it("covers signatures list/revoke, submissions list, feedback-export, notifications and whoami", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-admin-smoke", body: "v1 text." });
    await seedParticipant(server, {
      document: "doc-admin-smoke",
      person: "jane-doe",
      token: "t".repeat(20),
    });

    await server.inject({
      method: "POST",
      url: `/i/${"t".repeat(20)}/api/signature`,
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    const list = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-admin-smoke/signatures",
      headers: adminHeaders(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBe(1);

    const revoke = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-admin-smoke/signatures/jane-doe/revoke",
      headers: adminHeaders(),
      payload: { reason: "reported as forwarded" },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revoked).toBe(true);

    const submissions = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-admin-smoke/submissions?state=all",
      headers: adminHeaders(),
    });
    expect(submissions.statusCode).toBe(200);

    const feedback = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-admin-smoke/feedback-export",
      headers: adminHeaders(),
    });
    expect(feedback.statusCode).toBe(200);
    expect(feedback.json().document).toBe("doc-admin-smoke");

    const notifications = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-admin-smoke/notifications",
      headers: adminHeaders(),
    });
    expect(notifications.statusCode).toBe(200);

    const whoami = await server.inject({
      method: "GET",
      url: "/admin/api/whoami",
      headers: adminHeaders("test-suite"),
    });
    expect(whoami.statusCode).toBe(200);
    expect(JSON.parse(whoami.body)).toEqual({ actor: "cli:test-suite", capability: "admin" });

    await server.close();
  });
});
