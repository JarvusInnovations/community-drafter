import { afterEach, describe, expect, it } from "bun:test";

import { FakeMailer } from "../../lib/mailer/index.ts";
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

  /**
   * `specs/api/admin.md` § schedule (#60): a document that has never been
   * opened has no deadline to extend, and reporting that as
   * "comments_close_at must move later" tells the team about a stored
   * field instead of about their document.
   */
  it("returns no_deadline_set when there is no deadline to extend", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-never-opened", state: "draft" });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-never-opened/schedule",
      headers: adminHeaders(),
      payload: { comments_close_at: new Date(Date.now() + 86_400_000).toISOString() },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("no_deadline_set");
    expect(response.json().message).toContain("comment deadline");
    expect(response.json().message).toContain("docs open");
    expect(response.json().details.field).toBe("comments_close_at");

    await server.close();
  });

  /**
   * `specs/api/admin.md` § schedule: the response names each deadline that
   * moved with its old and new value — the payload `schedule-changed`
   * quotes when the operator asks for it — and says whom it did not tell.
   */
  it("reports the old and new value of each deadline that moved, and tells nobody without notify", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const commentsCloseAt = new Date(Date.now() + 3_600_000).toISOString();
    const signingClosesAt = new Date(Date.now() + 7_200_000).toISOString();
    await seedDocument(server, {
      slug: "doc-schedule-event",
      comments_close_at: commentsCloseAt,
      signing_closes_at: signingClosesAt,
    });

    const laterSigning = new Date(Date.now() + 10_800_000).toISOString();
    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-schedule-event/schedule",
      headers: adminHeaders(),
      payload: { signing_closes_at: laterSigning },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deadlines: [{ deadline: "signing_closes_at", from: signingClosesAt, to: laterSigning }],
      notify: { requested: false, would_notify: 0 },
    });

    await server.close();
  });

  /**
   * Issue #21 — `specs/screens/admin-dashboard.md` § Recent activity: the
   * feed reads the commit, so the commit has to carry the times. The email
   * already had them; the activity entry did not.
   */
  it("records the old and new time of each deadline on the commit, for the activity feed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const commentsCloseAt = new Date(Date.now() + 3_600_000).toISOString();
    const signingClosesAt = new Date(Date.now() + 7_200_000).toISOString();
    await seedDocument(server, {
      slug: "doc-schedule-activity",
      comments_close_at: commentsCloseAt,
      signing_closes_at: signingClosesAt,
    });

    const laterComments = new Date(Date.now() + 5_400_000).toISOString();
    const laterSigning = new Date(Date.now() + 10_800_000).toISOString();
    const extended = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-schedule-activity/schedule",
      headers: adminHeaders(),
      payload: { comments_close_at: laterComments, signing_closes_at: laterSigning },
    });
    expect(extended.statusCode).toBe(200);

    const activity = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-schedule-activity/activity",
      headers: adminHeaders(),
    });
    expect(activity.statusCode).toBe(200);
    const entry = activity.json()[0];
    expect(entry.action).toBe("extend");
    expect(entry.deadlines).toEqual([
      { deadline: "comments_close_at", from: commentsCloseAt, to: laterComments },
      { deadline: "signing_closes_at", from: signingClosesAt, to: laterSigning },
    ]);
    // The subject says where the deadlines landed, per specs/data-model.md.
    expect(entry.subject).toContain(`signing to ${laterSigning}`);

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
        audience: "public",
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
        audience: "public",
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

describe("POST /admin/api/documents/:slug/open deadline validation", () => {
  it("422s a deadline without a zone or already in the past, and stores UTC for an offset", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-dates",
        title: "Doc Dates",
        sender_name: "Team",
        reply_to: "t@example.org",
        audience: "public",
      },
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-dates/versions",
      headers: adminHeaders(),
      payload: { body: "# Hello\n\nText.", summary: "Initial draft" },
    });

    const noZone = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-dates/open",
      headers: adminHeaders(),
      payload: { comments_close_at: "2036-09-22T19:00", signing_closes_at: "2036-09-25T19:00Z" },
    });
    expect(noZone.statusCode).toBe(422);
    expect(noZone.json().error).toBe("validation_failed");
    expect(noZone.json().details.field).toBe("comments_close_at");

    const past = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-dates/open",
      headers: adminHeaders(),
      payload: {
        comments_close_at: "2020-09-02T21:00:00Z",
        signing_closes_at: "2036-09-25T19:00Z",
      },
    });
    expect(past.statusCode).toBe(422);
    expect(past.json().message).toContain("future");

    const ok = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-dates/open",
      headers: adminHeaders(),
      payload: {
        comments_close_at: "2036-09-22T19:00:00-04:00",
        signing_closes_at: "2036-09-25T19:00:00-04:00",
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().comments_close_at).toBe("2036-09-22T23:00:00.000Z");

    await server.close();
  });
});

describe("POST /admin/api/documents/:slug/open counts the invitations it delivered", () => {
  it("reports 7 of 8 sent when the mailer rejects one recipient, and leaves that one staged", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);

    await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-blast",
        title: "Doc Blast",
        sender_name: "Team",
        reply_to: "team@example.org",
        audience: "public",
      },
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-blast/versions",
      headers: adminHeaders(),
      payload: { body: "Initial text.", summary: "Initial draft" },
    });
    await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-blast/invitations/import",
      headers: adminHeaders(),
      payload: [
        // A comma in the display name is what broke the header in #46; the
        // count it produced is what this asserts.
        { name: "Samuel Park, MD", email: "samuel@example.org" },
        ...Array.from({ length: 7 }, (_, i) => ({
          name: `Invitee ${i}`,
          email: `invitee${i}@example.org`,
        })),
      ],
    });

    mailer.failNextFor("samuel@example.org", 3);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-blast/open",
      headers: adminHeaders(),
      payload: {
        comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
        signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("open");
    expect(response.json().invitations).toEqual({
      sent: 7,
      failed: 1,
      failures: [
        { person: "samuel-park-md", error: expect.stringContaining("samuel@example.org") },
      ],
    });

    const rejected = server.storage.readModel.getParticipation("doc-blast", "samuel-park-md");
    expect(rejected?.record.sent_at).toBeUndefined();
    expect(rejected?.record.notified?.invitation).toBeUndefined();

    const rows = (
      await server.inject({
        method: "GET",
        url: "/admin/api/documents/doc-blast/invitations",
        headers: adminHeaders(),
      })
    ).json() as Array<{ person: string; status: string }>;
    expect(rows.filter((r) => r.status === "not_sent").map((r) => r.person)).toEqual([
      "samuel-park-md",
    ]);
    expect(rows.filter((r) => r.status === "unopened").length).toBe(7);

    await server.close();
  });
});
