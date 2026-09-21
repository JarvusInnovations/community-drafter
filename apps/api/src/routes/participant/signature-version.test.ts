import { afterEach, describe, expect, it } from "bun:test";

import type { Signature } from "@signatories/shared";

import { adminHeaders, buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

type TestServer = Awaited<ReturnType<typeof buildTestServer>>["server"];

const TOKEN = "v".repeat(20);

/**
 * `specs/behaviors/signatures.md` § A signature belongs to a version. Every
 * case here is the nurses' scenario in miniature: sign on one version,
 * publish another, and ask what the record, the signer and the team say.
 */
async function openDocument(server: TestServer, slug: string): Promise<void> {
  await seedDocument(server, {
    slug,
    body: "Version one text.",
    comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
    signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
  });
  await seedParticipant(server, { document: slug, person: "jane-doe", token: TOKEN });
}

async function publish(
  server: TestServer,
  slug: string,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const response = await server.inject({
    method: "POST",
    url: `/admin/api/documents/${slug}/versions`,
    headers: adminHeaders(),
    payload: { body, summary: "Revised.", ...extra },
  });
  expect(response.statusCode).toBe(200);
}

async function signFromCard(server: TestServer): Promise<void> {
  const response = await server.inject({
    method: "POST",
    url: `/i/${TOKEN}/api/signature`,
    payload: { capacity: "personal", display_name: "Jane Doe" },
  });
  expect(response.statusCode).toBe(200);
}

async function bundleSignature(server: TestServer): Promise<Record<string, unknown>> {
  const response = await server.inject({ method: "GET", url: `/i/${TOKEN}/api/bundle` });
  expect(response.statusCode).toBe(200);
  return response.json().signature as Record<string, unknown>;
}

describe("a signature belongs to a version", () => {
  it("records the version signed and leaves it there when a new version publishes", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-belongs");

    await signFromCard(server);
    expect(await bundleSignature(server)).toMatchObject({ signed_on_version: 1 });

    await publish(server, "doc-belongs", "Version two text.");

    const bundle = await server.inject({ method: "GET", url: `/i/${TOKEN}/api/bundle` });
    expect(bundle.json().version.number).toBe(2);
    expect(bundle.json().signature).toMatchObject({ signed_on_version: 1 });

    await server.close();
  });

  it("moves the signature onto the current version when the signer re-affirms", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-keep");

    await signFromCard(server);
    await publish(server, "doc-keep", "Version two text.");

    const kept = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { confirm: true },
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({ signed_on_version: 2, revoked: false });
    expect(await bundleSignature(server)).toMatchObject({ signed_on_version: 2 });

    await server.close();
  });

  it("leaves the version alone when the signer only changes how they are listed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-listing-edit");

    await signFromCard(server);
    await publish(server, "doc-listing-edit", "Version two text.");

    const edited = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { display_name: "Jane A. Doe" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ display_name: "Jane A. Doe", signed_on_version: 1 });

    await server.close();
  });

  it("moves the signature onto the version a `sign` submission was made against", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-submit-keep");

    await signFromCard(server);
    await publish(server, "doc-submit-keep", "Version two text.");

    const submitted = await server.inject({
      method: "POST",
      url: `/i/${TOKEN}/api/submit`,
      payload: { version: 2, judgement: "sign", pending: 0 },
    });
    expect(submitted.statusCode).toBe(200);
    expect(await bundleSignature(server)).toMatchObject({ signed_on_version: 2 });

    await server.close();
  });

  it("never drags a signature backwards when an older version is submitted against", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-no-retreat");

    await signFromCard(server);
    await publish(server, "doc-no-retreat", "Version two text.");
    await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { confirm: true },
    });
    await publish(server, "doc-no-retreat", "Version three text.");

    const submitted = await server.inject({
      method: "POST",
      url: `/i/${TOKEN}/api/submit`,
      payload: { version: 1, judgement: "sign", pending: 0 },
    });
    expect(submitted.statusCode).toBe(200);
    expect(await bundleSignature(server)).toMatchObject({ signed_on_version: 2 });

    await server.close();
  });

  it("reads the version back from the commit trailer on a record written without the field", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-legacy");
    await publish(server, "doc-legacy", "Version two text.");

    // A record as it would have been written before `signed_on_version`
    // existed: the number lives only in the commit's `Version` trailer.
    const legacy = {
      capacity: "personal",
      display_name: "Jane Doe",
      authorized: true,
      conditional: false,
      listed: true,
      display_approved: true,
      revoked: false,
    } as Signature;
    await server.storage.commit(
      "sign",
      {
        actor: { kind: "participant" },
        subject: "sign: jane-doe on doc-legacy",
        document: "doc-legacy",
        person: "jane-doe",
        version: 2,
      },
      async (tx) => {
        await tx.participations.patch(
          { document: "doc-legacy", person: "jane-doe" },
          { signature: legacy },
        );
      },
    );

    await publish(server, "doc-legacy", "Version three text.");
    expect(await bundleSignature(server)).toMatchObject({ signed_on_version: 2 });

    await server.close();
  });
});

describe("the team is told which signatures are behind", () => {
  it("flags behind rows on the signatures list and counts them on the document", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-nurses",
      body: "Version one text.",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });

    const nurses = [
      { person: "elena-vasquez", token: "1".repeat(20) },
      { person: "priya-nair", token: "2".repeat(20) },
      { person: "marcus-hall", token: "3".repeat(20) },
      { person: "dana-liu", token: "4".repeat(20) },
    ];
    for (const nurse of nurses) {
      await seedParticipant(server, { document: "doc-nurses", ...nurse });
    }

    await publish(server, "doc-nurses", "Version two text.");
    for (const nurse of nurses) {
      const response = await server.inject({
        method: "POST",
        url: `/i/${nurse.token}/api/signature`,
        payload: { capacity: "personal", display_name: nurse.person },
      });
      expect(response.statusCode).toBe(200);
    }

    const beforePublish = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-nurses",
      headers: adminHeaders(),
    });
    expect(beforePublish.json().counts.signatures.behind).toBe(0);

    await publish(server, "doc-nurses", "Version three text.");

    const summary = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-nurses",
      headers: adminHeaders(),
    });
    expect(summary.json().counts.signatures.behind).toBe(4);

    const list = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-nurses/signatures",
      headers: adminHeaders(),
    });
    const rows = list.json() as Array<{ person: string; behind: boolean; signature: unknown }>;
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.behind)).toBe(true);
    expect(rows[0]?.signature).toMatchObject({ signed_on_version: 2 });

    // One nurse keeps her name: she is no longer behind, the other three are.
    const kept = await server.inject({
      method: "PATCH",
      url: `/i/${nurses[0]?.token}/api/signature`,
      payload: { confirm: true },
    });
    expect(kept.statusCode).toBe(200);

    const after = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-nurses",
      headers: adminHeaders(),
    });
    expect(after.json().counts.signatures.behind).toBe(3);

    await server.close();
  });

  it("never counts a revoked signature as behind", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await openDocument(server, "doc-revoked-behind");

    await signFromCard(server);
    await publish(server, "doc-revoked-behind", "Version two text.");
    const revoked = await server.inject({ method: "DELETE", url: `/i/${TOKEN}/api/signature` });
    expect(revoked.statusCode).toBe(200);

    const summary = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-revoked-behind",
      headers: adminHeaders(),
    });
    expect(summary.json().counts.signatures.behind).toBe(0);

    const list = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-revoked-behind/signatures?include_revoked=true",
      headers: adminHeaders(),
    });
    expect(list.json()[0]).toMatchObject({ behind: false });

    await server.close();
  });
});
