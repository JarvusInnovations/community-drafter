import { afterEach, describe, expect, it } from "bun:test";

import { FakeMailer } from "../lib/mailer/index.ts";
import {
  adminHeaders,
  buildTestServer,
  commitCount,
  seedDocument,
  seedParticipant,
} from "../routes/test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("NotificationDispatcher", () => {
  it("skips a target already marked in `notified` and sends nothing twice", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-idem" });
    await seedParticipant(server, {
      document: "doc-idem",
      person: "jane-doe",
      token: "a".repeat(20),
    });

    const first = await server.notifications.deliver({
      document: "doc-idem",
      eventKey: "reminder-1",
      actor: { kind: "system" },
      targets: [
        {
          person: "jane-doe",
          markNotified: true,
          render: (ctx) => ({ subject: "s", text: ctx.personalLink, html: "<p>x</p>" }),
        },
      ],
    });
    expect(first).toMatchObject({ sent: 1, failed: 0, skipped: 0, sentPeople: ["jane-doe"] });
    expect(mailer.sent.length).toBe(1);

    const second = await server.notifications.deliver({
      document: "doc-idem",
      eventKey: "reminder-1",
      actor: { kind: "system" },
      targets: [
        {
          person: "jane-doe",
          markNotified: true,
          render: (ctx) => ({ subject: "s", text: ctx.personalLink, html: "<p>x</p>" }),
        },
      ],
    });
    expect(second).toMatchObject({ sent: 0, failed: 0, skipped: 1, sentPeople: [], commit: null });
    expect(mailer.sent.length).toBe(1);

    const participation = server.storage.readModel.getParticipation("doc-idem", "jane-doe");
    expect(participation?.record.notified?.["reminder-1"]).toBeTruthy();

    await server.close();
  });

  it("batches successes into one `Action: send` commit for multiple recipients", async () => {
    const mailer = new FakeMailer();
    const { server, dataDir, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-batch" });
    for (const person of ["alice", "bob", "carol"]) {
      await seedParticipant(server, {
        document: "doc-batch",
        person,
        token: `${person}Token`.padEnd(20, "0"),
      });
    }

    const before = await commitCount(dataDir);
    const result = await server.notifications.deliver({
      document: "doc-batch",
      eventKey: "closed",
      actor: { kind: "system" },
      targets: ["alice", "bob", "carol"].map((person) => ({
        person,
        markNotified: true,
        render: () => ({ subject: "s", text: "t", html: "<p>t</p>" }),
      })),
    });
    expect(result.sent).toBe(3);
    const after = await commitCount(dataDir);
    expect(after - before).toBe(1);

    await server.close();
  });

  it("retries a failed send 3 times, records it as failed, and `retry` re-dispatches it", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-retry" });
    await seedParticipant(server, {
      document: "doc-retry",
      person: "jane-doe",
      token: "b".repeat(20),
      email: "jane@example.org",
    });

    mailer.failNextFor("jane@example.org", 3);
    const result = await server.notifications.deliver({
      document: "doc-retry",
      eventKey: "closed",
      actor: { kind: "system" },
      targets: [
        {
          person: "jane-doe",
          markNotified: true,
          render: () => ({ subject: "s", text: "t", html: "<p>t</p>" }),
        },
      ],
    });
    expect(result).toMatchObject({ sent: 0, failed: 1, skipped: 0, commit: null });
    expect(server.notifications.failedCount("doc-retry")).toBe(1);

    const participation = server.storage.readModel.getParticipation("doc-retry", "jane-doe");
    expect(participation?.record.notified?.closed).toBeUndefined();

    const retried = await server.notifications.retry("doc-retry", {}, { kind: "system" });
    expect(retried.retried).toBe(1);
    expect(retried.sent).toBe(1);
    expect(server.notifications.failedCount("doc-retry")).toBe(0);

    await server.close();
  });

  it("GET .../notifications reports the failed count from the dispatcher", async () => {
    const mailer = new FakeMailer();
    const { server, cleanup } = await buildTestServer({ mailer });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-status" });
    await seedParticipant(server, {
      document: "doc-status",
      person: "jane-doe",
      token: "c".repeat(20),
      email: "jane@example.org",
    });

    mailer.failNextFor("jane@example.org", 3);
    await server.notifications.deliver({
      document: "doc-status",
      eventKey: "closed",
      actor: { kind: "system" },
      targets: [
        {
          person: "jane-doe",
          markNotified: true,
          render: () => ({ subject: "s", text: "t", html: "<p>t</p>" }),
        },
      ],
    });

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-status/notifications",
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().failed).toBe(1);

    await server.close();
  });
});
