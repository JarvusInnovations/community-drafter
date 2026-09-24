import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Fastify from "fastify";

import app from "../app.ts";
import { createTestDataRepo } from "./test-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return stdout;
}

/** Issue #27: boot brings a stale sheet config in the data repo up to this build's. */
describe("sheet-config sync at boot", () => {
  it("rewrites and commits a stale operators.toml, then can write the new field", async () => {
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_OPERATOR_EMAIL = "founder@example.org";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const configPath = join(dataDir, ".gitsheets", "operators.toml");
    const fresh = readFileSync(configPath, "utf8");
    const stale = fresh.replace(/\n# specs\/behaviors\/operators\.md § Superadmins[\s\S]*$/u, "\n");
    expect(stale).not.toBe(fresh);
    writeFileSync(configPath, stale);
    await runGit(["add", ".gitsheets"], dataDir);
    await runGit(
      ["-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-q", "-m", "stale config"],
      dataDir,
    );

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
    });
    await server.ready();
    cleanups.push(() => server.close());

    expect(readFileSync(configPath, "utf8")).toBe(fresh);
    const log = await runGit(["log", "--format=%s"], dataDir);
    expect(log).toContain("chore(gitsheets): update operators sheet config");
    // The bootstrap superadmin write only validates once the config carries the field.
    expect(server.storage.readModel.getOperatorByEmail("founder@example.org")?.superadmin).toBe(
      true,
    );
  });
});
