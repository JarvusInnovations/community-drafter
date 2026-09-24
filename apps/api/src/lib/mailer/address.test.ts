import { describe, expect, it } from "bun:test";

import { formatAddress } from "./types.ts";

describe("formatAddress", () => {
  it("quotes display names so commas and quotes cannot split the header", () => {
    expect(formatAddress({ name: "Samuel Park, MD", email: "s@example.org" })).toBe(
      '"Samuel Park, MD" <s@example.org>',
    );
    expect(formatAddress({ name: 'Pat "PJ" O\'Brien', email: "p@example.org" })).toBe(
      '"Pat \\"PJ\\" O\'Brien" <p@example.org>',
    );
    expect(formatAddress({ name: "  ", email: "bare@example.org" })).toBe("bare@example.org");
  });
});
