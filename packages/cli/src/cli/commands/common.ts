import { readFileSync } from "node:fs";

import { DrafterClient } from "../client.js";
import { resolveConfig } from "../config.js";
import { bool, str, type Parsed } from "../flags.js";
import { renderJson } from "../output.js";

/**
 * Build the API client from a parsed command's globally-allowed
 * `--actor`/`--profile` flags. Deliberately called from *inside* each
 * command handler (not from `resolveContext`) — `runAxiCli` does not wrap
 * `resolveContext` in the same try/catch as the handler body, so a config
 * error raised there would crash uncaught instead of rendering as a
 * structured error (AXI §6).
 */
export function clientFrom(parsed: Parsed): DrafterClient {
  return new DrafterClient(
    resolveConfig({ actor: str(parsed, "--actor"), profile: str(parsed, "--profile") }),
  );
}

export function wantsJson(parsed: Parsed): boolean {
  return bool(parsed, "--json");
}

/** Render either raw JSON (`--json`) or the TOON form built by `toToon`. */
export function render(parsed: Parsed, data: unknown, toToon: () => string): string {
  return wantsJson(parsed) ? renderJson(data) : toToon();
}

/**
 * Read a file, or stdin when the path is `-`. Plain `node:fs`/`process.stdin`
 * only — the committed bundle runs under plain `node`, not just Bun.
 */
export async function readFileOrStdin(path: string): Promise<string> {
  if (path === "-") return readStdin();
  return readFileSync(path, "utf8");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
