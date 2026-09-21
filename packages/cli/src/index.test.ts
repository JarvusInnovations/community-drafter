import { describe, expect, it } from "bun:test";

import { CLI_PACKAGE_NAME } from "./index.ts";

describe("@signatories/cli", () => {
  it("exports its package name", () => {
    expect(CLI_PACKAGE_NAME).toBe("@signatories/cli");
  });
});
