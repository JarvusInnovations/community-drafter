import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-root-relative paths shared by `scripts/build-cli.ts`,
 * `scripts/build-skill.ts`, and the drift-gate test. Resolved from this
 * file's own location (not `process.cwd()`) so the build works the same
 * whether invoked from the repo root or from `packages/cli`.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export const ENTRY_POINT = join(REPO_ROOT, "packages/cli/src/cli/bin.ts");
export const BUNDLE_OUTFILE = join(REPO_ROOT, "skills/signatories-axi/scripts/signatories-axi.mjs");
export const SKILL_MD_PATH = join(REPO_ROOT, "skills/signatories-axi/SKILL.md");
