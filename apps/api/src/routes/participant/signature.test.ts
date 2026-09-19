import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("POST /i/:token/api/signature", () => {
  it("succeeds during commenting and during signing", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-commenting",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-commenting",
      person: "jane-doe",
      token: "a".repeat(20),
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${"a".repeat(20)}/api/signature`,
      payload: { capacity: "personal", display_name: "Jane Doe", version: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      capacity: "personal",
      display_name: "Jane Doe",
      revoked: false,
    });

    await seedDocument(server, {
      slug: "doc-signing",
      comments_close_at: new Date(Date.now() - 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-signing",
      person: "john-doe",
      token: "b".repeat(20),
    });

    const signingResponse = await server.inject({
      method: "POST",
      url: `/i/${"b".repeat(20)}/api/signature`,
      payload: { capacity: "personal", display_name: "John Doe", version: 1 },
    });
    expect(signingResponse.statusCode).toBe(200);

    await server.close();
  });

  it("returns phase_closed naming signing_closes_at once closed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const signingClosesAt = new Date(Date.now() - 1_000).toISOString();
    await seedDocument(server, {
      slug: "doc-closed",
      comments_close_at: new Date(Date.now() - 7_200_000).toISOString(),
      signing_closes_at: signingClosesAt,
    });
    await seedParticipant(server, {
      document: "doc-closed",
      person: "jane-doe",
      token: "c".repeat(20),
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${"c".repeat(20)}/api/signature`,
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe("phase_closed");
    expect(body.details.phase).toBe("closed");
    expect(body.details.signing_closes_at).toBe(signingClosesAt);

    await server.close();
  });

  it("returns attestation_required for an official signature without the attestation", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-official",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-official",
      person: "jane-doe",
      token: "d".repeat(20),
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${"d".repeat(20)}/api/signature`,
      payload: {
        capacity: "official",
        display_name: "Jane Doe",
        org: "Save the Academy Coalition",
        title: "Director",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("attestation_required");

    const withAttestation = await server.inject({
      method: "POST",
      url: `/i/${"d".repeat(20)}/api/signature`,
      payload: {
        capacity: "official",
        display_name: "Jane Doe",
        org: "Save the Academy Coalition",
        title: "Director",
        authorized: true,
      },
    });
    expect(withAttestation.statusCode).toBe(200);
    expect(withAttestation.json().capacity).toBe("official");

    await server.close();
  });
});

describe("DELETE /i/:token/api/signature", () => {
  it("revokes an active signature and 404s revoking twice", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-revoke",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-revoke",
      person: "jane-doe",
      token: "e".repeat(20),
    });

    await server.inject({
      method: "POST",
      url: `/i/${"e".repeat(20)}/api/signature`,
      payload: { capacity: "personal", display_name: "Jane Doe" },
    });

    const revoke = await server.inject({
      method: "DELETE",
      url: `/i/${"e".repeat(20)}/api/signature`,
      payload: { reason: "changed my mind" },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revoked).toBe(true);

    const revokeAgain = await server.inject({
      method: "DELETE",
      url: `/i/${"e".repeat(20)}/api/signature`,
    });
    expect(revokeAgain.statusCode).toBe(404);

    await server.close();
  });
});
