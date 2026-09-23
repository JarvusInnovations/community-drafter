import { describe, expect, it } from "bun:test";

import { deliverableIsDraft } from "./deliverable.ts";

describe("deliverableIsDraft", () => {
  it("is a draft until signing closes", () => {
    expect(deliverableIsDraft({ phase: "commenting" })).toBe(true);
    expect(deliverableIsDraft({ phase: "signing" })).toBe(true);
    expect(deliverableIsDraft({ phase: "closed" })).toBe(false);
  });

  it("goes clean on delivery, even while signing is open", () => {
    expect(deliverableIsDraft({ phase: "signing", delivered_at: "2026-09-30T18:00:00Z" })).toBe(
      false,
    );
  });
});
