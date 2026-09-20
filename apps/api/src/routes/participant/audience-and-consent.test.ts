import { afterEach, describe, expect, it } from "bun:test";

import { adminHeaders, buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const TOKEN = "parishtoken123456789";

async function seedSignedParish(slug: string) {
  const built = await buildTestServer();
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
  return built;
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

/** `specs/data-model.md` § Audience — one home in the record, derived everywhere. */
describe("audience", () => {
  it("defaults to closed on create, and `--audience public` writes public_access: read", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

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
        list_visible_to: ["City Arts Council"],
      },
    });
    expect(closed.statusCode).toBe(201);
    expect(closed.json()).toMatchObject({
      audience: "closed",
      public_access: "none",
      list_visible_to: ["City Arts Council"],
    });

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
    expect(open.json()).toMatchObject({ audience: "public", public_access: "read" });

    await server.close();
  });

  it("derives `public` for a document created before the word existed", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc-legacy", public_access: "read" });

    const response = await server.inject({
      method: "GET",
      url: "/admin/api/documents/doc-legacy",
      headers: adminHeaders(),
    });
    expect(response.json()).toMatchObject({ audience: "public", public_access: "read" });

    await server.close();
  });

  it("refuses an `audience` and a `public_access` that disagree", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    const response = await server.inject({
      method: "POST",
      url: "/admin/api/documents",
      headers: adminHeaders(),
      payload: {
        slug: "doc-conflict",
        title: "Conflict",
        sender_name: "The Team",
        reply_to: "team@example.org",
        audience: "closed",
        public_access: "read",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: "validation_failed",
      details: { field: "audience" },
    });

    await server.close();
  });

  it("reaches the participant bundle, with the organizations a closed list is shared with", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);
    await seedDocument(server, {
      slug: "doc-bundle",
      comments_close_at: new Date(Date.now() + 3_600_000).toISOString(),
      signing_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      list_visible_to: ["City Arts Council"],
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
    expect(response.json().document).toMatchObject({
      audience: "closed",
      list_visible_to: ["City Arts Council"],
    });

    await server.close();
  });
});
