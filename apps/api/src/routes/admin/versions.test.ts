import { afterEach, describe, expect, it } from "bun:test";

import { adminHeaders, buildTestServer, seedDocument, TEST_ACTOR } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("POST /admin/api/documents/:slug/versions", () => {
  it("publishing during signing extends signing_closes_at to at least now + revocation_window_hours, in one commit", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const signingClosesAt = new Date(Date.now() + 3_600_000).toISOString(); // closes in 1h
    await seedDocument(server, {
      slug: "doc-extend",
      body: "Original text.",
      comments_close_at: new Date(Date.now() - 3_600_000).toISOString(), // already in signing
      signing_closes_at: signingClosesAt,
      revocation_window_hours: 72,
    });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-extend/versions",
      headers: adminHeaders(),
      payload: { body: "Revised text.", summary: "Tightened term 2." },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.number).toBe(2);
    expect(body.commit).toBeTruthy();
    expect(new Date(body.signing_closes_at).getTime()).toBeGreaterThanOrEqual(
      Date.now() + 72 * 60 * 60 * 1000 - 5_000,
    );

    const updated = server.storage.readModel.getDocument("doc-extend");
    expect(updated?.record.signing_closes_at).toBe(body.signing_closes_at);
    // One commit: the document body change and the extension landed together.
    expect(updated?.versions.length).toBe(2);

    await server.close();
  });

  it("refuses a publish whose text is byte-identical to the current version (no_change)", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-nochange", body: "Same text." });

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-nochange/versions",
      headers: adminHeaders(),
      payload: { body: "Same text.", summary: "No real change" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("no_change");

    await server.close();
  });

  it("sets dispositions on the affected submissions in the same publish commit", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-disposed", body: "v1 text." });
    await server.storage.commit(
      "invite",
      { actor: TEST_ACTOR, subject: "invite: jane-doe on doc-disposed", document: "doc-disposed" },
      async (tx) => {
        await tx.people.upsert({
          id: "jane-doe",
          name: "Jane Doe",
          email: "jane@example.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-disposed",
          person: "jane-doe",
          token: "f".repeat(20),
          source: "admin",
        });
      },
    );
    await server.storage.commit(
      "comment",
      {
        actor: { kind: "participant" },
        subject: "comment: jane-doe on doc-disposed (jane-doe-aaaa)",
        document: "doc-disposed",
        person: "jane-doe",
        submission: "jane-doe-aaaa",
        version: 1,
      },
      async (tx) => {
        await tx.submissions.upsert({
          document: "doc-disposed",
          id: "jane-doe-aaaa",
          person: "jane-doe",
          version: 1,
          state: "submitted",
          judgement: "comment",
          comments: [{ id: "c1", body: "Consider clarifying section 2." }],
        });
      },
    );

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-disposed/versions",
      headers: adminHeaders(),
      payload: {
        body: "v2 text, section 2 clarified.",
        summary: "Clarified section 2",
        dispositions: [{ submission: "jane-doe-aaaa", comment: "c1", outcome: "accepted" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().notified.dispositions).toBe(1);

    const submission = server.storage.readModel.getSubmission("doc-disposed", "jane-doe-aaaa");
    expect(submission?.record.comments?.[0]?.disposition).toBe("accepted");
    expect(submission?.record.comments?.[0]?.disposition_version).toBe(2);

    await server.close();
  });

  it("requires a note for a declined disposition", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-declined-disposition", body: "v1 text." });
    await server.storage.commit(
      "invite",
      {
        actor: TEST_ACTOR,
        subject: "invite: jane-doe on doc-declined-disposition",
        document: "doc-declined-disposition",
      },
      async (tx) => {
        await tx.people.upsert({
          id: "jane-doe",
          name: "Jane Doe",
          email: "jane@example.org",
          source: "admin",
        });
        await tx.participations.upsert({
          document: "doc-declined-disposition",
          person: "jane-doe",
          token: "g".repeat(20),
          source: "admin",
        });
      },
    );
    await server.storage.commit(
      "comment",
      {
        actor: { kind: "participant" },
        subject: "comment: jane-doe (jane-doe-bbbb)",
        document: "doc-declined-disposition",
        person: "jane-doe",
        submission: "jane-doe-bbbb",
        version: 1,
      },
      async (tx) => {
        await tx.submissions.upsert({
          document: "doc-declined-disposition",
          id: "jane-doe-bbbb",
          person: "jane-doe",
          version: 1,
          state: "submitted",
          judgement: "comment",
          comments: [{ id: "c1", body: "A point." }],
        });
      },
    );

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents/doc-declined-disposition/versions",
      headers: adminHeaders(),
      payload: {
        body: "v2 text.",
        summary: "v2",
        dispositions: [{ submission: "jane-doe-bbbb", comment: "c1", outcome: "declined" }],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("validation_failed");

    await server.close();
  });
});
