import { afterEach, describe, expect, it } from "bun:test";

import type { Signature } from "@community-drafter/shared";

import { buildTestServer, seedDocument, seedParticipant, TEST_ACTOR } from "../test-support.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function signAs(
  server: Awaited<ReturnType<typeof buildTestServer>>["server"],
  document: string,
  person: string,
  signature: Signature,
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
      await tx.participations.patch({ document, person }, { signature });
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("GET /i/:token/api/bundle — signatories", () => {
  it("counts only revoked=false, display_approved=true signatures; orgs alphabetical, individuals chronological", async () => {
    const { server, cleanup } = await buildTestServer();
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc-signatories", body: "text", show_signatories: "list" });

    const people: Array<{ person: string; token: string }> = [
      { person: "zeta-org-rep", token: "1".repeat(20) },
      { person: "alpha-org-rep", token: "2".repeat(20) },
      { person: "early-bird", token: "3".repeat(20) },
      { person: "late-comer", token: "4".repeat(20) },
      { person: "unlisted-person", token: "5".repeat(20) },
      { person: "revoked-person", token: "6".repeat(20) },
      { person: "unapproved-person", token: "7".repeat(20) },
    ];
    for (const p of people) {
      await seedParticipant(server, {
        document: "doc-signatories",
        person: p.person,
        token: p.token,
      });
    }

    await signAs(server, "doc-signatories", "zeta-org-rep", {
      capacity: "official",
      display_name: "Rep Z",
      org: "Zeta Org",
      title: "Director",
      authorized: true,
      listed: true,
      display_approved: true,
      signed_on_version: 1,
    });
    await signAs(server, "doc-signatories", "alpha-org-rep", {
      capacity: "official",
      display_name: "Rep A",
      org: "Alpha Org",
      title: "Director",
      authorized: true,
      listed: true,
      display_approved: true,
      signed_on_version: 1,
    });
    await signAs(server, "doc-signatories", "early-bird", {
      capacity: "personal",
      display_name: "Early Bird",
      authorized: true,
      listed: true,
      display_approved: true,
      signed_on_version: 1,
    });
    // Git commit dates are second-resolution; sleep past a second boundary
    // so early-bird and late-comer land in strictly increasing seconds and
    // the chronological-order assertion below isn't a coin flip.
    await sleep(1_100);
    await signAs(server, "doc-signatories", "late-comer", {
      capacity: "personal",
      display_name: "Late Comer",
      authorized: true,
      listed: true,
      display_approved: true,
      signed_on_version: 1,
    });
    await signAs(server, "doc-signatories", "unlisted-person", {
      capacity: "personal",
      display_name: "Unlisted Person",
      authorized: true,
      listed: false,
      display_approved: true,
      signed_on_version: 1,
    });
    await signAs(server, "doc-signatories", "revoked-person", {
      capacity: "personal",
      display_name: "Revoked Person",
      authorized: true,
      listed: true,
      display_approved: true,
      signed_on_version: 1,
      revoked: true,
    });
    // display_approved: false — the `[phase 2]` public-source path; never
    // produced by this plan's own endpoints, but the counting rule itself
    // must still honor it.
    await server.storage.commit(
      "sign",
      {
        actor: TEST_ACTOR,
        subject: "sign: unapproved-person on doc-signatories (test fixture)",
        document: "doc-signatories",
        person: "unapproved-person",
        version: 1,
      },
      async (tx) => {
        await tx.participations.patch(
          { document: "doc-signatories", person: "unapproved-person" },
          {
            signature: {
              capacity: "personal",
              display_name: "Unapproved Person",
              authorized: true,
              listed: true,
              display_approved: false,
              signed_on_version: 1,
            },
          },
        );
      },
    );

    const response = await server.inject({
      method: "GET",
      url: `/i/${people[0]?.token}/api/bundle`,
    });
    expect(response.statusCode).toBe(200);
    const signatories = response.json().signatories;

    // Current signatories: zeta-org-rep, alpha-org-rep, early-bird,
    // late-comer, unlisted-person = 5. revoked-person and
    // unapproved-person are excluded.
    expect(signatories.organizations).toBe(2);
    expect(signatories.individuals).toBe(3);
    expect(signatories.unlisted).toBe(1);

    const listNames = signatories.list.map((s: { display_name: string }) => s.display_name);
    // Organizations first, alphabetically by org (Alpha before Zeta); then
    // individuals chronologically (early-bird before late-comer);
    // unlisted-person is counted but not named.
    expect(listNames).toEqual(["Rep A", "Rep Z", "Early Bird", "Late Comer"]);

    await server.close();
  });
});
