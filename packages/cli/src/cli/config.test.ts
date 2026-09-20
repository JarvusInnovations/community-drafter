import { afterEach, describe, expect, it } from "bun:test";

import { resolveProfileName } from "./config.js";

const original = process.env.DRAFTER_PROFILE;
afterEach(() => {
  if (original === undefined) delete process.env.DRAFTER_PROFILE;
  else process.env.DRAFTER_PROFILE = original;
});

/** `specs/api/admin-cli.md`: `--profile`, else `DRAFTER_PROFILE`, else `default`. */
describe("resolveProfileName", () => {
  it("defaults to `default` with nothing set", () => {
    delete process.env.DRAFTER_PROFILE;
    expect(resolveProfileName(undefined)).toBe("default");
  });

  it("uses DRAFTER_PROFILE when no flag is given, ignoring blank values", () => {
    process.env.DRAFTER_PROFILE = "stac-bot";
    expect(resolveProfileName(undefined)).toBe("stac-bot");
    process.env.DRAFTER_PROFILE = "   ";
    expect(resolveProfileName(undefined)).toBe("default");
  });

  it("lets --profile override the environment", () => {
    process.env.DRAFTER_PROFILE = "stac-bot";
    expect(resolveProfileName("work")).toBe("work");
  });
});
