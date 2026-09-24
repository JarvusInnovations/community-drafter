import { describe, expect, it } from "bun:test";

import { ALWAYS_SENT_NOTE, TOGGLES } from "./toggles.ts";

describe("preferences toggle definitions", () => {
  it("lists the two toggles in the spec's exact order", () => {
    expect(TOGGLES.map((t) => t.key)).toEqual(["my_comments_addressed", "reminders"]);
  });

  it("carries the spec's exact description for each toggle", () => {
    const byKey = Object.fromEntries(TOGGLES.map((t) => [t.key, t]));
    expect(byKey.my_comments_addressed?.description).toBe(
      "When the team answers your comments in a new version and asks us to tell you.",
    );
    expect(byKey.reminders?.description).toBe(
      "A nudge before a deadline if you haven't answered yet. Turns off by itself once you sign, comment or decline.",
    );
  });

  it("describes only what is always sent, and nothing retired", () => {
    expect(ALWAYS_SENT_NOTE).toContain("confirm your signature");
    expect(ALWAYS_SENT_NOTE).toContain("delivered");
    expect(ALWAYS_SENT_NOTE).not.toContain("final");
  });
});
