import { describe, expect, it } from "bun:test";

import type { DocumentRecord } from "@community-drafter/shared";

import { ApiError } from "../errors.ts";
import { assertPhase, derivePhase } from "./phase.ts";

function doc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    slug: "coalition-charter",
    title: "Coalition Charter",
    state: "open",
    body: "text",
    ...overrides,
  };
}

describe("derivePhase", () => {
  it("returns draft/withdrawn/closed directly from document.state", () => {
    expect(derivePhase(doc({ state: "draft" }), new Date())).toBe("draft");
    expect(derivePhase(doc({ state: "withdrawn" }), new Date())).toBe("withdrawn");
    expect(derivePhase(doc({ state: "closed" }), new Date())).toBe("closed");
  });

  it("derives commenting/signing/closed from the clock when state is open", () => {
    const record = doc({
      comments_close_at: "2026-09-20T00:00:00Z",
      signing_closes_at: "2026-09-30T00:00:00Z",
    });
    expect(derivePhase(record, new Date("2026-09-19T00:00:00Z"))).toBe("commenting");
    expect(derivePhase(record, new Date("2026-09-25T00:00:00Z"))).toBe("signing");
    expect(derivePhase(record, new Date("2026-10-01T00:00:00Z"))).toBe("closed");
  });

  it("treats the boundary instants as the later phase (half-open intervals)", () => {
    const record = doc({
      comments_close_at: "2026-09-20T00:00:00Z",
      signing_closes_at: "2026-09-30T00:00:00Z",
    });
    expect(derivePhase(record, new Date("2026-09-20T00:00:00Z"))).toBe("signing");
    expect(derivePhase(record, new Date("2026-09-30T00:00:00Z"))).toBe("closed");
  });
});

describe("assertPhase", () => {
  const record = doc({
    comments_close_at: "2026-09-20T00:00:00Z",
    signing_closes_at: "2026-09-30T00:00:00Z",
  });

  it("allows sign in commenting and signing", () => {
    expect(assertPhase(record, new Date("2026-09-19T00:00:00Z"), "sign")).toBe("commenting");
    expect(assertPhase(record, new Date("2026-09-25T00:00:00Z"), "sign")).toBe("signing");
  });

  it("rejects sign once closed, naming signing_closes_at", () => {
    expect(() => assertPhase(record, new Date("2026-10-01T00:00:00Z"), "sign")).toThrow(ApiError);
    try {
      assertPhase(record, new Date("2026-10-01T00:00:00Z"), "sign");
      throw new Error("unreachable");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("phase_closed");
      expect(apiErr.status).toBe(409);
      expect(apiErr.details).toEqual({
        phase: "closed",
        signing_closes_at: "2026-09-30T00:00:00Z",
      });
    }
  });

  it("allows admin_publish in draft, commenting and signing but not closed", () => {
    expect(assertPhase(doc({ state: "draft", body: "" }), new Date(), "admin_publish")).toBe(
      "draft",
    );
    expect(assertPhase(record, new Date("2026-09-25T00:00:00Z"), "admin_publish")).toBe("signing");
    expect(() => assertPhase(record, new Date("2026-10-01T00:00:00Z"), "admin_publish")).toThrow(
      ApiError,
    );
  });

  it("blocks every write action once withdrawn", () => {
    const withdrawn = doc({ state: "withdrawn" });
    expect(() => assertPhase(withdrawn, new Date(), "sign")).toThrow(ApiError);
    expect(() => assertPhase(withdrawn, new Date(), "admin_publish")).toThrow(ApiError);
  });

  it("allows change_prefs everywhere except draft", () => {
    expect(assertPhase(record, new Date("2026-09-19T00:00:00Z"), "change_prefs")).toBe(
      "commenting",
    );
    expect(assertPhase(record, new Date("2026-10-01T00:00:00Z"), "change_prefs")).toBe("closed");
    expect(assertPhase(doc({ state: "withdrawn" }), new Date(), "change_prefs")).toBe("withdrawn");
    expect(() => assertPhase(doc({ state: "draft" }), new Date(), "change_prefs")).toThrow(
      ApiError,
    );
  });
});
