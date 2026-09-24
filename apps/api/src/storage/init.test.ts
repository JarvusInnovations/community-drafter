import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { initDataRepo } from "./init.ts";
import { createTestDataRepoWithRemote } from "./test-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function runGitsheetsCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; code: number }> {
  const bin = join(process.cwd(), "node_modules", ".bin", "gitsheets");
  const proc = Bun.spawn([bin, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gitsheets ${args.join(" ")} failed (${code}): ${stderr}`);
  return { stdout, code };
}

describe("initDataRepo", () => {
  it("commits the five sheet configs into an empty (cloned) data repo", async () => {
    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);

    for (const name of ["documents", "operators", "people", "participations", "submissions"]) {
      expect(existsSync(join(dataDir, ".gitsheets", `${name}.toml`))).toBe(true);
    }

    // The committed configs are immediately usable by the human gitsheets
    // CLI (an equivalent check to `gitsheets-axi query documents` — the
    // agent-facing CLI wraps the same library and config format).
    const { stdout } = await runGitsheetsCli(["query", "documents"], dataDir);
    expect(stdout.trim()).toBe(""); // no records yet, but the sheet is queryable
  });

  it("refuses to overwrite a data repo whose sheets already exist", async () => {
    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);

    await expect(initDataRepo({ dataDir })).rejects.toThrow(/already exists/);
  });
});
