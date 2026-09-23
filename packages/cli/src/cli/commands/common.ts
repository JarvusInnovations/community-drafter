import { readFileSync } from "node:fs";

import { SignatoriesClient } from "../client.js";
import { resolveConfig } from "../config.js";
import { bool, str, type Parsed } from "../flags.js";
import { renderJson } from "../output.js";

/**
 * Build the API client from a parsed command's globally-allowed
 * `--profile` flag. Deliberately called from *inside* each command handler
 * (not from `resolveContext`) — `runAxiCli` does not wrap `resolveContext`
 * in the same try/catch as the handler body, so a config error raised
 * there would crash uncaught instead of rendering as a structured error
 * (AXI §6).
 */
export function clientFrom(parsed: Parsed): SignatoriesClient {
  return new SignatoriesClient(resolveConfig({ profile: str(parsed, "--profile") }));
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

/**
 * One line for an announcement a command may make (`specs/api/admin.md` §
 * schedule / versions): what it did when asked, and whom it did not tell
 * when not — so an operator always reads the count before or instead of
 * the send.
 */
export function announceLine(report: {
  requested: boolean;
  would_notify: number;
  sent?: number;
  failed?: number;
}): string {
  if (!report.requested) {
    return report.would_notify === 0
      ? "not sent (nobody to tell)"
      : `not sent (${report.would_notify} would be told with the flag)`;
  }
  return `sent ${report.sent ?? 0} of ${report.would_notify}${
    report.failed ? `, ${report.failed} failed` : ""
  }`;
}
