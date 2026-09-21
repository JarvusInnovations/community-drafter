import { describe, expect, it } from "bun:test";

import { buildCliBundle } from "./build/bundle.ts";
import { buildSkillDoc } from "./build/skill-doc.ts";

/**
 * CI drift gate (`plans/admin-cli.md` Validation): fails if
 * `skills/drafter-axi/scripts/drafter-axi.mjs` or the generated region of
 * `skills/drafter-axi/SKILL.md` is stale relative to `src/cli/` — i.e.
 * someone changed the CLI source without rebuilding (`bun run build` in
 * this package) and committing the result. Wired into this package's own
 * `test` script, so `bun run --filter='@signatories/cli' test`
 * (the existing test.yml matrix) runs it on every PR with no separate
 * workflow needed.
 */
describe("committed skill bundle (drift gate)", () => {
  it("scripts/drafter-axi.mjs matches a fresh build of src/cli/", async () => {
    const result = await buildCliBundle(true);
    expect(result.ok, result.message).toBe(true);
  }, 30_000);

  it("SKILL.md's generated command reference matches reference.ts", () => {
    const result = buildSkillDoc(true);
    expect(result.ok).toBe(true);
  });
});
