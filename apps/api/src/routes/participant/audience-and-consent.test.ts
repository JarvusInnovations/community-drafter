import { afterEach, describe, expect, it } from "bun:test";

import { FakeMailer } from "../../lib/mailer/index.ts";
import {
  adminHeaders,
  buildTestServer,
  seedDocument,
  seedParticipant,
  TEST_ACTOR,
} from "../test-support.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

const TOKEN = "parishtoken123456789";

async function seedSignedParish(slug: string) {
  const mailer = new FakeMailer();
  const built = await buildTestServer({ mailer });
  cleanups.push(built.cleanup);
  await seedDocument(built.server, {
    slug,
    comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
    signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
  });
  await seedParticipant(built.server, {
    document: slug,
    person: "margaret-doyle",
    token: TOKEN,
    name: "Sr. Margaret Doyle",
  });
  const signed = await built.server.inject({
    method: "POST",
    url: `/i/${TOKEN}/api/signature`,
    payload: {
      capacity: "official",
      display_name: "Sr. Margaret Doyle",
      org: "St. Brigid Parish Council",
      title: "Chair",
      authorized: true,
      version: 1,
    },
  });
  expect(signed.statusCode).toBe(200);
  return { ...built, mailer };
}

/** `specs/behaviors/signatures.md` § Capacity — "Official capacity requires a title" (issue #81). */
describe("official capacity requires a title", () => {
  it("refuses an official signature with no title, naming the field", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-title",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await seedParticipant(server, {
      document: "doc-title",
      person: "jane-doe",
      token: "titletoken1234567890",
    });

    const response = await server.inject({
      method: "POST",
      url: `/i/${"titletoken1234567890"}/api/signature`,
      payload: {
        capacity: "official",
        display_name: "Jane Doe",
        org: "Example Alliance",
        title: "   ",
        authorized: true,
        version: 1,
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: "validation_failed",
      details: { field: "title" },
    });

    await server.close();
  });
});

/**
 * `specs/behaviors/signatures.md` § Changing how a signature is listed
 * (issue #70 — the parish signer could swap the organization with no
 * further attestation and no message).
 */
describe("changing the organization requires the attestation again", () => {
  it("refuses the swap without `authorized`, and accepts it with", async () => {
    const { server } = await seedSignedParish("doc-parish");

    const refused = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { org: "St. Brigid Parish School" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: "attestation_required" });

    const unchanged = server.storage.readModel.getParticipation("doc-parish", "margaret-doyle");
    expect(unchanged?.record.signature?.org).toBe("St. Brigid Parish Council");

    const accepted = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { org: "St. Brigid Parish School", authorized: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ org: "St. Brigid Parish School" });

    await server.close();
  });

  it("leaves an unchanged organization alone — editing only the title needs no attestation", async () => {
    const { server } = await seedSignedParish("doc-parish-title");

    const response = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { title: "President" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ title: "President" });

    await server.close();
  });

  it("refuses to leave an official signature with a blank title", async () => {
    const { server } = await seedSignedParish("doc-parish-blank");

    const response = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { title: " " },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ details: { field: "title" } });

    await server.close();
  });
});

/** `specs/behaviors/notifications.md` § Messages → `listing-changed-<ts>`. */
describe("a listing edit sends the signer a confirmation", () => {
  it("sends on a display-field change and not on a bare re-affirmation", async () => {
    const { server, mailer } = await seedSignedParish("doc-listing");
    const afterSigning = mailer.sent.length;

    const edited = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { title: "President" },
    });
    expect(edited.statusCode).toBe(200);

    const listingMail = mailer.sent.slice(afterSigning);
    expect(listingMail).toHaveLength(1);
    expect(listingMail[0]?.subject).toContain("how you're listed changed");
    expect(listingMail[0]?.text).toContain("St. Brigid Parish Council — Sr. Margaret Doyle");

    // `{ confirm: true }` moves the version, not the listing — no message.
    const confirmed = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { confirm: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(afterSigning + 1);

    await server.close();
  });

  it("says plainly when the signer is no longer named on the list", async () => {
    const { server, mailer } = await seedSignedParish("doc-unlisted");
    const afterSigning = mailer.sent.length;

    const response = await server.inject({
      method: "PATCH",
      url: `/i/${TOKEN}/api/signature`,
      payload: { listed: false },
    });
    expect(response.statusCode).toBe(200);
    expect(mailer.sent[afterSigning]?.text).toContain("no longer shown on the signatory list");

    await server.close();
  });
});

/**
 * `specs/data-model.md` § Audience — a stored field, orthogonal to
 * `public_access`: who the finished statement goes to versus who may read
 * the working draft.
 */
describe("audience", () => {
  it("stores what it is given and leaves public_access alone", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    // A letter to a named body whose draft anyone with the link may read —
    // the combination #87's derivation could not express.
    const closed = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-closed",
        title: "Closed",
        sender_name: "The Team",
        reply_to: "team@example.org",
        audience: "closed",
        addressed_to: ["St. Brigid Parish Council"],
        public_access: "read",
      },
    });
    expect(closed.statusCode).toBe(201);
    expect(closed.json()).toMatchObject({
      audience: "closed",
      addressed_to: ["St. Brigid Parish Council"],
      public_access: "read",
    });

    // ... and a public statement drafted invitee-only.
    const open = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-public",
        title: "Public",
        sender_name: "The Team",
        reply_to: "team@example.org",
        audience: "public",
      },
    });
    expect(open.statusCode).toBe(201);
    expect(open.json()).toMatchObject({ audience: "public" });
    expect(open.json().public_access ?? "none").toBe("none");

    await server.close();
  });

  // `specs/api/conventions.md`: a body that misses a required field fails
  // Fastify's own schema — 400 `invalid_request` — before any handler runs.
  it("refuses a create with no `audience`, naming the field", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-no-audience",
        title: "No audience",
        sender_name: "The Team",
        reply_to: "team@example.org",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_request" });
    expect(response.json().message).toContain("audience");

    await server.close();
  });

  it("refuses a closed document with no `addressed_to`", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-unaddressed",
        title: "Unaddressed",
        sender_name: "The Team",
        reply_to: "team@example.org",
        audience: "closed",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: "validation_failed",
      details: { field: "addressed_to" },
    });

    await server.close();
  });

  it("reads a document written before the field existed as closed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await server.storage.commit(
      "create",
      { actor: TEST_ACTOR, subject: "create: doc-legacy", document: "doc-legacy" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc-legacy",
          title: "Legacy",
          state: "open",
          body: "Hello world.",
          public_access: "read",
          created_by: TEST_ACTOR.email,
          operators: [TEST_ACTOR.email],
        });
      },
    );

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-legacy",
      headers: adminHeaders(),
    });
    expect(response.json()).toMatchObject({ audience: "closed", public_access: "read" });
    expect(response.json().addressed_to).toBeUndefined();

    await server.close();
  });

  it("round-trips both fields through PATCH, and refuses closing without recipients", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-update", audience: "public" });

    const refused = await server.inject({
      method: "PATCH",
      url: "/admin/api/documents/doc-update",
      headers: adminHeaders(),
      payload: { audience: "closed" },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ details: { field: "addressed_to" } });

    const accepted = await server.inject({
      method: "PATCH",
      url: "/admin/api/documents/doc-update",
      headers: adminHeaders(),
      payload: { audience: "closed", addressed_to: ["City Arts Council"] },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      audience: "closed",
      addressed_to: ["City Arts Council"],
    });

    // Back to public, with the recipients left in place — `addressed_to`
    // is allowed on a public document.
    const reopened = await server.inject({
      method: "PATCH",
      url: "/admin/api/documents/doc-update",
      headers: adminHeaders(),
      payload: { audience: "public" },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({
      audience: "public",
      addressed_to: ["City Arts Council"],
    });

    await server.close();
  });

  it("reaches the participant bundle with the recipients, and without public_access", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-bundle",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      audience: "closed",
      addressed_to: ["St. Brigid Parish Council"],
      public_access: "read",
    });
    await seedParticipant(server, {
      document: "doc-bundle",
      person: "jane-doe",
      token: "bundletoken123456789",
    });

    const response = await server.inject({
      method: "GET",
      url: `/i/${"bundletoken123456789"}/api/bundle`,
    });
    const document = response.json().document;
    expect(document).toMatchObject({
      audience: "closed",
      addressed_to: ["St. Brigid Parish Council"],
    });
    expect(document.public_access).toBeUndefined();

    await server.close();
  });
});
