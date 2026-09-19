import { describe, expect, it } from "bun:test";

import { SHARED_PACKAGE_NAME } from "./index.ts";

describe("@community-drafter/shared", () => {
  it("exports its package name", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@community-drafter/shared");
  });
});
