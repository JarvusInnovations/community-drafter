import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const TOKEN_A = "a".repeat(20);

describe("POST /i/:token/api/submit", () => {
  it("refuses with unsaved_items when pending > 0", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-pending" });
    await seedParticipant(server, { document: "doc-pending", person: "jane-doe", token: TOKEN_A });

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/submit`,
      payload: { version: 1, judgement: "comment", pending: 2 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("unsaved_items");

    await server.close();
  });

  it("refuses sign_conditional with no comments (judgement_requires_comments)", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-conditional" });
    await seedParticipant(server, {
      document: "doc-conditional",
      person: "jane-doe",
      token: TOKEN_A,
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/submit`,
      payload: {
        version: 1,
        judgement: "sign_conditional",
        pending: 0,
        signature: { capacity: "personal", display_name: "Jane Doe" },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("judgement_requires_comments");

    await server.close();
  });

  it("sign_conditional with a comment succeeds, sets signature.conditional and one submit commit", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-sign-conditional" });
    await seedParticipant(server, {
      document: "doc-sign-conditional",
      person: "jane-doe",
      token: TOKEN_A,
    });

    await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "Please reconsider paragraph two.", client_id: "c-1" },
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/submit`,
      payload: {
        version: 1,
        judgement: "sign_conditional",
        pending: 0,
        signature: { capacity: "personal", display_name: "Jane Doe" },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.submission.state).toBe("submitted");
    expect(body.submission.judgement).toBe("sign_conditional");
    expect(body.submission.comments).toHaveLength(1);
    expect(body.signature.conditional).toBe(true);
    expect(body.signature.revoked).toBe(false);

    const participation = server.storage.readModel.getParticipation(
      "doc-sign-conditional",
      "jane-doe",
    );
    expect(participation?.record.signature?.conditional).toBe(true);
    expect(participation?.record.signature?.revoked).toBeFalsy();

    const position = server.storage.readModel.getPosition("doc-sign-conditional", "jane-doe");
    expect(position?.judgement).toBe("sign_conditional");

    await server.close();
  });

  it("a plain sign submitted with a judgement of 'sign' and no comments works outside commenting too", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-signing-phase",
      comments_close_at: new Date(Date.now() - 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-signing-phase",
      person: "jane-doe",
      token: TOKEN_A,
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/submit`,
      payload: {
        version: 1,
        judgement: "sign",
        pending: 0,
        signature: { capacity: "personal", display_name: "Jane Doe" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().signature.revoked).toBe(false);

    await server.close();
  });

  it("refuses a submission with comments outside the commenting phase", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-comments-in-signing",
      comments_close_at: new Date(Date.now() + 1_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-comments-in-signing",
      person: "jane-doe",
      token: TOKEN_A,
    });

    await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "A comment.", client_id: "c-1" },
    });

    // Wait for commenting to close.
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/submit`,
      payload: { version: 1, judgement: "comment", pending: 0 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("phase_closed");

    await server.close();
  });

  it("decline with no comments succeeds during signing and revokes any live signature", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-decline-signing",
      comments_close_at: new Date(Date.now() - 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-decline-signing",
      person: "jane-doe",
      token: TOKEN_A,
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/submit`,
      payload: { version: 1, judgement: "decline", pending: 0, reason: "Changed my mind." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().submission.judgement).toBe("decline");

    const position = server.storage.readModel.getPosition("doc-decline-signing", "jane-doe");
    expect(position?.judgement).toBe("decline");

    await server.close();
  });

  it("sends the review-receipt email and fires exactly one submit event", async () => {
    const { server, cleanup, mailer } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-receipt" });
    await seedParticipant(server, { document: "doc-receipt", person: "jane-doe", token: TOKEN_A });

    await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/draft/comments`,
      payload: { version: 1, body: "A note.", client_id: "c-1" },
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${TOKEN_A}/api/submit`,
      payload: { version: 1, judgement: "comment", pending: 0 },
    });
    expect(response.statusCode).toBe(200);

    const { FakeMailer } = await import("../../lib/mailer/index.ts");
    const fakeMailer = mailer as InstanceType<typeof FakeMailer>;
    const receipt = fakeMailer.sent.filter((m) => m.subject.includes("we received your review"));
    expect(receipt).toHaveLength(1);
    expect(receipt[0]?.to.email).toBe("jane-doe@example.org");

    await server.close();
  });
});
