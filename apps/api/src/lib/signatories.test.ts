import { describe, expect, it } from "bun:test";

import type { ParticipationEntry } from "../storage/read-model.ts";
import { computeSignatories } from "./signatories.ts";

type SignatureInput = {
  capacity: "personal" | "official";
  display_name: string;
  org?: string;
  listed?: boolean;
  revoked?: boolean;
};

function entry(person: string, signature: SignatureInput, at = "2026-09-20T12:00:00Z") {
  return {
    record: {
      document: "doc",
      person,
      token: person,
      signature: {
        authorized: true,
        conditional: false,
        display_approved: true,
        listed: true,
        revoked: false,
        signed_on_version: 1,
        ...signature,
      },
    },
    signatureEvents: [{ action: "sign", at, actor: "participant", commit: "abc" }],
  } as unknown as ParticipationEntry;
}

/**
 * `specs/behaviors/signatures.md` § Display: "`listed = false` signers are
 * counted but not named ... They are counted **once**, in that clause alone."
 */
describe("computeSignatories", () => {
  it("counts an unlisted signer once, in `unlisted` alone", () => {
    const summary = computeSignatories(
      [
        entry("a", { capacity: "personal", display_name: "A" }, "2026-09-20T10:00:00Z"),
        entry("b", { capacity: "personal", display_name: "B" }, "2026-09-20T11:00:00Z"),
        entry(
          "c",
          { capacity: "personal", display_name: "C", listed: false },
          "2026-09-20T12:00:00Z",
        ),
      ],
      "list",
    );

    expect(summary).not.toBeNull();
    expect(summary?.individuals).toBe(2);
    expect(summary?.unlisted).toBe(1);
    expect(summary?.organizations).toBe(0);
    expect(summary?.list?.map((item) => item.display_name)).toEqual(["A", "B"]);
  });

  it("leaves an unlisted organization out of the organization count too", () => {
    const summary = computeSignatories(
      [
        entry("a", { capacity: "official", display_name: "A", org: "Listed Org" }),
        entry("b", {
          capacity: "official",
          display_name: "B",
          org: "Quiet Org",
          listed: false,
        }),
      ],
      "count",
    );

    expect(summary?.organizations).toBe(1);
    expect(summary?.individuals).toBe(0);
    expect(summary?.unlisted).toBe(1);
  });

  it("never counts a revoked signature", () => {
    const summary = computeSignatories(
      [
        entry("a", { capacity: "personal", display_name: "A" }),
        entry("b", { capacity: "personal", display_name: "B", revoked: true }),
      ],
      "count",
    );

    expect(summary?.individuals).toBe(1);
    expect(summary?.unlisted).toBe(0);
  });
});
