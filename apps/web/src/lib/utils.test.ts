import { describe, expect, it } from "bun:test";

import { cn } from "./utils.ts";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts", () => {
    const isHidden = false;
    expect(cn("p-2", isHidden && "hidden", "p-4")).toBe("p-4");
  });
});
