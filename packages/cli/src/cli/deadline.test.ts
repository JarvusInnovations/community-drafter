import { AxiError } from "axi-sdk-js";
import { describe, expect, it } from "bun:test";

import { parseDeadline } from "./deadline.ts";

const USAGE = "drafter-axi docs open <slug> --comments-close <when> --signing-closes <when>";

describe("parseDeadline", () => {
  it("passes a zoned ISO time through, normalized to UTC", () => {
    const zulu = parseDeadline("2026-10-01T21:00:00Z", "--signing-closes", USAGE);
    expect(zulu.iso).toBe("2026-10-01T21:00:00.000Z");
    const offset = parseDeadline("2026-10-01T17:00:00-04:00", "--signing-closes", USAGE);
    expect(offset.iso).toBe("2026-10-01T21:00:00.000Z");
    expect(offset.note).toContain("--signing-closes:");
  });

  it("reads a zone-less time in the machine's local zone and says so", () => {
    for (const input of ["2026-10-01T17:00", "2026-10-01 17:00", "2026-10-01T17:00:30"]) {
      const resolved = parseDeadline(input, "--comments-close", USAGE);
      expect(resolved.iso).toBe(new Date(input.replace(" ", "T")).toISOString());
      expect(resolved.note).toContain("read as");
      expect(resolved.note).toContain(resolved.iso);
    }
  });

  it("rejects anything else with a usage error that shows the accepted forms", () => {
    for (const input of ["09/25/2026 11:59pm", "tomorrow", "2026-10-01", ""]) {
      expect(() => parseDeadline(input, "--comments-close", USAGE)).toThrow(AxiError);
    }
    try {
      parseDeadline("next week", "--comments-close", USAGE);
    } catch (error) {
      expect((error as Error).message).toContain("your local time");
    }
  });
});
