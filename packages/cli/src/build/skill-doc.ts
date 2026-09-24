import { readFileSync, writeFileSync } from "node:fs";

import { spliceGeneratedRegions } from "../cli/skill.js";
import { SKILL_MD_PATH } from "./paths.js";
import type { BuildResult } from "./bundle.js";

/**
 * Splice the generated command-reference region into
 * `skills/signatories-axi/SKILL.md`, or (with `check: true`) report whether it
 * is stale relative to `src/cli/reference.ts`.
 */
export function buildSkillDoc(check: boolean): BuildResult {
  const src = readFileSync(SKILL_MD_PATH, "utf8");
  const out = spliceGeneratedRegions(src);

  if (src === out) {
    return { ok: true, message: `${SKILL_MD_PATH} is up to date` };
  }
  if (check) {
    return {
      ok: false,
      message: `${SKILL_MD_PATH} is out of date — run \`bun run build\` in packages/cli and commit the result`,
    };
  }
  writeFileSync(SKILL_MD_PATH, out);
  return { ok: true, message: `Updated ${SKILL_MD_PATH}` };
}
