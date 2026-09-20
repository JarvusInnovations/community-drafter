import { AxiError } from "axi-sdk-js";
import { describe, expect, it } from "bun:test";

import {
  bool,
  csv,
  parseFlags,
  parseSubcommand,
  requirePositional,
  requireStr,
  str,
} from "./flags.ts";

describe("parseFlags", () => {
  it("collects positionals and declared value/boolean flags", () => {
    const parsed = parseFlags("docs create", ["my-slug", "--title", "Hello", "--final"], {
      positionals: 1,
      value: ["--title"],
      boolean: ["--final"],
    });
    expect(parsed.positional).toEqual(["my-slug"]);
    expect(str(parsed, "--title")).toBe("Hello");
    expect(bool(parsed, "--final")).toBe(true);
  });

  it("rejects an unknown flag with exit-2 usage error, listing valid flags", () => {
    expect(() => parseFlags("docs show", ["slug", "--bogus"], { positionals: 1 })).toThrow(
      AxiError,
    );
    try {
      parseFlags("docs show", ["slug", "--bogus"], { positionals: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("UNKNOWN_FLAG");
    }
  });

  it("never silently drops a flag it doesn't recognize", () => {
    // A dropped flag would make an agent believe a filter was applied when it
    // wasn't (AXI §6) — parseFlags must throw, not ignore.
    expect(() =>
      parseFlags("people list", ["slug", "--stat", "closed"], {
        positionals: 1,
        value: ["--status"],
      }),
    ).toThrow();
  });

  it("always allows --help even when undeclared", () => {
    const parsed = parseFlags("docs show", ["slug", "--help"], { positionals: 1 });
    expect(bool(parsed, "--help")).toBe(true);
  });

  it("always allows the global --json/--profile flags", () => {
    const parsed = parseFlags("docs show", ["slug", "--json", "--profile", "work"], {
      positionals: 1,
    });
    expect(bool(parsed, "--json")).toBe(true);
    expect(str(parsed, "--profile")).toBe("work");
  });

  it("rejects more positionals than declared", () => {
    expect(() => parseFlags("docs close", ["a", "b"], { positionals: 1 })).toThrow(AxiError);
  });

  it("requires a value for a value flag", () => {
    expect(() =>
      parseFlags("docs create", ["slug", "--title"], { positionals: 1, value: ["--title"] }),
    ).toThrow();
  });
});

describe("requirePositional / requireStr", () => {
  it("throws a usage error when missing", () => {
    const parsed = parseFlags("docs show", [], { positionals: 1 });
    expect(() => requirePositional(parsed, 0, "slug", "usage")).toThrow(AxiError);
  });

  it("throws when a required flag is absent", () => {
    const parsed = parseFlags("docs create", ["slug"], { positionals: 1, value: ["--title"] });
    expect(() => requireStr(parsed, "--title", "usage")).toThrow(AxiError);
  });
});

describe("csv", () => {
  it("splits and trims, dropping empty entries", () => {
    expect(csv("a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(csv(undefined)).toEqual([]);
  });
});

describe("parseSubcommand", () => {
  it("dispatches to the matching subcommand's own flag spec", () => {
    const { sub, parsed } = parseSubcommand("docs", ["show", "my-slug"], {
      show: { positionals: 1 },
      create: { positionals: 1, value: ["--title"] },
    });
    expect(sub).toBe("show");
    expect(parsed.positional).toEqual(["my-slug"]);
  });

  it("rejects an unknown subcommand", () => {
    expect(() => parseSubcommand("docs", ["frobnicate"], { show: { positionals: 1 } })).toThrow(
      AxiError,
    );
  });

  it("requires a subcommand", () => {
    expect(() => parseSubcommand("docs", [], { show: { positionals: 1 } })).toThrow(AxiError);
  });
});
