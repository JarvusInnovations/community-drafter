import { describe, expect, test } from "bun:test";

import { emailAllowed } from "./cookie.ts";

describe("emailAllowed", () => {
  test("refuses everyone when no allowlist is configured (fail closed)", () => {
    expect(emailAllowed("anyone@example.org", undefined, undefined)).toBe(false);
    expect(emailAllowed("anyone@example.org", "", "")).toBe(false);
  });

  test("admits exact emails, @domain wildcards and listed domains", () => {
    expect(emailAllowed("Jane@Example.org", "jane@example.org", undefined)).toBe(true);
    expect(emailAllowed("sam@example.org", "@example.org", undefined)).toBe(true);
    expect(emailAllowed("sam@example.org", "*@example.org", undefined)).toBe(true);
    expect(emailAllowed("sam@example.org", undefined, "example.org")).toBe(true);
    expect(emailAllowed("sam@elsewhere.org", "jane@example.org", "example.org")).toBe(false);
  });
});
