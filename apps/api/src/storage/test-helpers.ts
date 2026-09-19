import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDataRepo } from "./init.ts";

async function run(args: string[], cwd?: string): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`);
  return { stdout, code };
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A bare repo standing in for the data repo's remote, and a temp dir to clean up after. */
export async function createBareRemote(): Promise<{ remoteDir: string; cleanup: () => void }> {
  const remoteDir = tempDir("cd-storage-remote-");
  await run(["init", "--bare", "-b", "main", remoteDir]);
  return { remoteDir, cleanup: () => rmSync(remoteDir, { recursive: true, force: true }) };
}

/**
 * A local git repo (no remote) with the four sheet configs already
 * committed via `initDataRepo` — the shape `openDataRepo` expects to just
 * "open" (non-empty working directory). Used by tests that don't need a
 * push daemon / remote.
 */
export async function createTestDataRepo(): Promise<{ dataDir: string; cleanup: () => void }> {
  const dataDir = tempDir("cd-storage-data-");
  await run(["init", "-b", "main", dataDir]);
  await initDataRepo({ dataDir });
  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

/**
 * A local clone of a bare remote, with the four sheet configs committed and
 * pushed, for tests exercising the push daemon / boot-time clone.
 */
export async function createTestDataRepoWithRemote(): Promise<{
  remoteDir: string;
  dataDir: string;
  cleanup: () => void;
}> {
  const { remoteDir, cleanup: cleanupRemote } = await createBareRemote();
  const dataDir = tempDir("cd-storage-clone-");
  await run(["clone", remoteDir, dataDir]);
  await initDataRepo({ dataDir });
  await run(["push", "origin", "main"], dataDir);

  return {
    remoteDir,
    dataDir,
    cleanup: () => {
      rmSync(dataDir, { recursive: true, force: true });
      cleanupRemote();
    },
  };
}
