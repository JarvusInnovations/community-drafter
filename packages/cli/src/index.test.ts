import { describe, expect, it } from "bun:test";

import { CLI_PACKAGE_NAME } from "./index.ts";

describe("@community-drafter/cli", () => {
  it("exports its package name", () => {
    expect(CLI_PACKAGE_NAME).toBe("@community-drafter/cli");
  });
});
