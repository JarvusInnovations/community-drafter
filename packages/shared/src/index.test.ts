import { describe, expect, it } from "bun:test";

import { SHARED_PACKAGE_NAME } from "./index.ts";

describe("@signatories/shared", () => {
  it("exports its package name", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@signatories/shared");
  });
});
