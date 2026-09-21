import { describe, expect, it } from "bun:test";

import { deliverableIsDraft } from "./deliverable.ts";

describe("deliverableIsDraft", () => {
  it("needs both a final version and a closed signing phase", () => {
    expect(deliverableIsDraft({ phase: "signing", versions: [{ final: false }] })).toBe(true);
    expect(deliverableIsDraft({ phase: "signing", versions: [{ final: true }] })).toBe(true);
    expect(deliverableIsDraft({ phase: "closed", versions: [{ final: false }] })).toBe(true);
    expect(deliverableIsDraft({ phase: "closed", versions: [{ final: true }] })).toBe(false);
  });

  it("reads final from any version, not only the current one", () => {
    expect(
      deliverableIsDraft({ phase: "closed", versions: [{ final: true }, { final: false }] }),
    ).toBe(false);
  });
});
