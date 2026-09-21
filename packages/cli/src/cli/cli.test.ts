import { AxiError } from "axi-sdk-js";
import { describe, expect, it } from "bun:test";

import { formatError } from "./cli.ts";
import { ApiCallError, exitCodeForCode } from "./errors.ts";

/**
 * `specs/api/admin-cli.md` § Output rules: "Errors map API `error` codes to
 * exit codes: 2 validation, 3 phase/conflict, 4 not found, 5 auth, 1 other;
 * the message is the API's `message`."
 */
describe("exitCodeForCode", () => {
  it("maps validation-shaped codes to 2", () => {
    expect(exitCodeForCode("validation_failed")).toBe(2);
    expect(exitCodeForCode("invalid_request")).toBe(2);
    expect(exitCodeForCode("USAGE")).toBe(2);
    expect(exitCodeForCode("UNKNOWN_FLAG")).toBe(2);
  });

  it("maps phase/conflict codes to 3", () => {
    expect(exitCodeForCode("phase_closed")).toBe(3);
    expect(exitCodeForCode("no_change")).toBe(3);
    expect(exitCodeForCode("deadline_not_later")).toBe(3);
    expect(exitCodeForCode("no_version")).toBe(3);
  });

  it("maps not_found to 4", () => {
    expect(exitCodeForCode("not_found")).toBe(4);
  });

  it("maps auth codes to 5", () => {
    expect(exitCodeForCode("unauthenticated")).toBe(5);
    expect(exitCodeForCode("forbidden")).toBe(5);
  });

  it("maps everything else to 1", () => {
    expect(exitCodeForCode("rate_limited")).toBe(1);
    expect(exitCodeForCode("internal_error")).toBe(1);
    expect(exitCodeForCode("something_unmapped")).toBe(1);
  });
});

describe("formatError", () => {
  it("renders the API's own message verbatim and maps its exit code", () => {
    const result = formatError(
      new ApiCallError("phase_closed", "Comments closed Sep 23 at 5:00 PM EDT."),
    );
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("Comments closed Sep 23 at 5:00 PM EDT.");
  });

  it("includes suggestions as a help block", () => {
    const result = formatError(
      new AxiError("--title is required", "USAGE", ["Run `signatories-axi docs create ...`"]),
    );
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("help[1]:");
    expect(result.output).toContain("Run `signatories-axi docs create ...`");
  });

  it("never leaks a raw stack trace for an unexpected error", () => {
    const result = formatError(new Error("ECONNREFUSED boom"));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("unexpected failure");
    expect(result.output).not.toContain("at ");
  });
});
