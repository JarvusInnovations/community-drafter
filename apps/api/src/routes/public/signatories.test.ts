import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, seedDocument, seedParticipant } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function signAs(
  server: Awaited<ReturnType<typeof buildTestServer>>["server"],
  document: string,
  person: string,
  capacity: "personal" | "official",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await server.storage.commit(
    "sign",
    {
      actor: { kind: "participant" },
      subject: `sign: ${person} on ${document}`,
      document,
      person,
      version: 1,
    },
    async (tx) => {
      await tx.participations.patch(
        { document, person },
        {
          signature: {
            capacity,
            display_name: `Display ${person}`,
            authorized: true,
            listed: true,
            display_approved: true,
            signed_on_version: 1,
            ...extra,
          },
        },
      );
    },
  );
}

describe("GET /d/:slug/signatories.json", () => {
  it("carries open CORS and a short cache lifetime, with counts matching the participant bundle", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-parity",
      public_access: "read",
      show_signatories: "list",
    });
    await seedParticipant(server, {
      document: "doc-parity",
      person: "org-rep",
      token: "1".repeat(20),
    });
    await seedParticipant(server, {
      document: "doc-parity",
      person: "jane-doe",
      token: "2".repeat(20),
    });
    await seedParticipant(server, {
      document: "doc-parity",
      person: "unlisted-person",
      token: "3".repeat(20),
    });

    await signAs(server, "doc-parity", "org-rep", "official", {
      org: "Acme Coalition",
      title: "Director",
    });
    await signAs(server, "doc-parity", "jane-doe", "personal");
    await signAs(server, "doc-parity", "unlisted-person", "personal", { listed: false });

    const publicRes = await server.inject({ method: "GET", url: "/d/doc-parity/signatories.json" });
    expect(publicRes.statusCode).toBe(200);
    expect(publicRes.headers["access-control-allow-origin"]).toBe("*");
    expect(publicRes.headers["cache-control"]).toContain("max-age=60");

    const participantRes = await server.inject({
      method: "GET",
      url: `/i/${"1".repeat(20)}/api/bundle`,
    });
    const participantSignatories = participantRes.json().signatories;
    const publicSignatories = publicRes.json();

    expect(publicSignatories.organizations).toBe(participantSignatories.organizations);
    expect(publicSignatories.individuals).toBe(participantSignatories.individuals);
    expect(publicSignatories.unlisted).toBe(participantSignatories.unlisted);
    expect(publicSignatories.organizations).toBe(1);
    // jane-doe and unlisted-person are both current personal signatories, but
    // `specs/behaviors/signatures.md` § Display counts an unlisted signer
    // *once*, in `unlisted` alone — so `individuals` is jane-doe only and the
    // three figures never overlap (issue #68).
    expect(publicSignatories.individuals).toBe(1);
    expect(publicSignatories.unlisted).toBe(1);

    await server.close();
  });

  it("404s when show_signatories=none instead of exposing zeroed counts", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, {
      slug: "doc-hidden-signatories",
      public_access: "read",
      show_signatories: "none",
    });

    const response = await server.inject({
      method: "GET",
      url: "/d/doc-hidden-signatories/signatories.json",
    });
    expect(response.statusCode).toBe(404);

    await server.close();
  });
});
