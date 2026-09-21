/**
 * bun scripts/build-cli.ts            # write skills/signatories-axi/scripts/signatories-axi.mjs
 * bun scripts/build-cli.ts --check    # fail if the committed bundle is stale
 */
import { buildCliBundle } from "../src/build/bundle.js";

const check = process.argv.includes("--check");
const result = await buildCliBundle(check);
console.log(result.message);
if (!result.ok) process.exit(1);
