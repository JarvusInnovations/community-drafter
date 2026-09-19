/**
 * bun scripts/build-skill.ts            # rewrite skills/drafter-axi/SKILL.md
 * bun scripts/build-skill.ts --check    # fail if SKILL.md is stale
 */
import { buildSkillDoc } from "../src/build/skill-doc.js";

const check = process.argv.includes("--check");
const result = buildSkillDoc(check);
console.log(result.message);
if (!result.ok) process.exit(1);
