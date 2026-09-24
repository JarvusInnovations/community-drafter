import { afterEach, describe, expect, it } from "bun:test";

import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedParticipant,
} from "../routes/test-support.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("signature and revocation confirmations", () => {
  it("are sent regardless of preferences and contain the personal link", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-confirm",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-confirm",
      person: "jane-doe",
      token: "confirmtoken1234567890",
      notify: {
        every_revision: false,
        daily_digest: false,
        phase_changes: false,
        my_comments_addressed: false,
        reminders: false,
      },
    });

    await server.inject({
      method: "POST",
      url: "/i/confirmtoken1234567890/api/signature",
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    const fakeMailer = mailer as import("../lib/mailer/index.ts").FakeMailer;
    const signed = fakeMailer.sent.filter((m) => m.subject.includes("you signed"));
    expect(signed.length).toBe(1);
    expect(signed[0]?.text).toContain("/i/confirmtoken1234567890");

    await server.inject({
      method: "DELETE",
      url: "/i/confirmtoken1234567890/api/signature",
      payload: { reason: "changed my mind" },
    });
    const revoked = fakeMailer.sent.filter((m) => m.subject.includes("signature was removed"));
    expect(revoked.length).toBe(1);
    expect(revoked[0]?.text).toContain("/i/confirmtoken1234567890");
    expect(revoked[0]?.text).toContain("changed my mind");

    await server.close();
  });
});

describe("MAILER=export", () => {
  it("invitations/send marks notified.invitation and the dispatcher's export mailer records the row", async () => {
    const { ExportMailer } = await import("../lib/mailer/index.ts");
    const exportMailer = new ExportMailer();
    const { server, cleanup } = await buildTestServer({ mailer: exportMailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-export" });
    await seedParticipant(server, {
      document: "doc-export",
      person: "jane-doe",
      token: "exporttoken1234567890",
    });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-export/invitations/send",
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().csv).toContain("name,email,subject,link");
    expect(response.json().csv).toContain("jane-doe@example.org");

    const participation = server.storage.readModel.getParticipation("doc-export", "jane-doe");
    expect(participation?.record.notified?.invitation).toBeTruthy();

    const rows = exportMailer.peek();
    expect(rows.length).toBe(1);
    expect(rows[0]?.email).toBe("jane-doe@example.org");
    expect(rows[0]?.link).toContain("/i/exporttoken1234567890");

    await server.close();
  });
});

describe("failed sends and retry", () => {
  it("a failed send retries 3 times, shows up as failed, and `retry` re-dispatches it", async () => {
    const { FakeMailer } = await import("../lib/mailer/index.ts");
    const fakeMailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer: fakeMailer });
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-fail",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-fail",
      person: "jane-doe",
      token: "failtoken1234567890ab",
      email: "jane@example.org",
    });

    fakeMailer.failNextFor("jane@example.org", 3);
    await server.inject({
      method: "POST",
      url: "/i/failtoken1234567890ab/api/signature",
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    const status = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-fail/notifications",
      headers: adminHeaders(),
    });
    expect(status.json().failed).toBe(1);

    const retry = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-fail/notifications/retry",
      headers: adminHeaders(),
      payload: {},
    });
    expect(retry.json().retried).toBe(1);
    expect(retry.json().sent).toBe(1);
    // The confirmation the retry delivered, plus the operators'
    // first-signature notice (`specs/behaviors/notifications.md`
    // § Operator digest), which is operator mail and was never in the
    // dispatcher's failure bucket to retry.
    expect(fakeMailer.sent.filter((m) => m.to.email === "jane@example.org").length).toBe(1);
    expect(fakeMailer.sent.length).toBe(2);

    const statusAfter = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-fail/notifications",
      headers: adminHeaders(),
    });
    expect(statusAfter.json().failed).toBe(0);

    await server.close();
  });
});
