import { describe, expect, it } from "bun:test";

import { ALWAYS_CONFIRM_NOTE, FORCED_EXPLANATION, TOGGLES } from "./toggles.ts";

describe("preferences toggle definitions", () => {
  it("lists the five toggles in the spec's exact order", () => {
    expect(TOGGLES.map((t) => t.key)).toEqual([
      "every_revision",
      "daily_digest",
      "phase_changes",
      "my_comments_addressed",
      "reminders",
    ]);
  });

  it("carries the spec's exact description for every toggle that has one", () => {
    const byKey = Object.fromEntries(TOGGLES.map((t) => [t.key, t]));
    expect(byKey.every_revision?.description).toBe(
      "One email each time the text is revised, with what changed.",
    );
    expect(byKey.daily_digest?.description).toBe(
      "At most one email a day, only on days something changed.",
    );
    expect(byKey.phase_changes?.description).toBe(
      "When comments close, when the final text is published, when the signing window closes, and if a deadline moves.",
    );
    expect(byKey.reminders?.description).toBe(
      "A nudge if you haven't acted yet. Turns off by itself once you sign, comment or decline.",
    );
  });

  it("has the forced-toggle explanation and the always-confirm note", () => {
    expect(FORCED_EXPLANATION).toContain("we'll always tell you");
    expect(ALWAYS_CONFIRM_NOTE).toContain("confirm when you sign");
  });
});
