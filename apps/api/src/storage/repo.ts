import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { openRepo, openStore } from "gitsheets";

import { syncSheetConfigs } from "./init.ts";

import { validators, type DataStore } from "./schemas.ts";

export interface OpenDataRepoOptions {
  /** Local working-copy directory for the data repo (created if missing). */
  dataDir: string;
  /** Clone source; required only if `dataDir` is empty. */
  repoUrl?: string;
  branch?: string;
  log?: (message: string) => void;
}

export interface DataRepoHandle {
  repo: Awaited<ReturnType<typeof openRepo>>;
  store: DataStore;
  dataDir: string;
}

function isEmptyDir(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

async function cloneInto(
  dataDir: string,
  repoUrl: string,
  branch: string | undefined,
): Promise<void> {
  const args = ["clone"];
  if (branch) args.push("--branch", branch);
  args.push(repoUrl, dataDir);

  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    throw new Error(`git clone ${repoUrl} failed (${code}): ${stderr}`);
  }
}

/**
 * `specs/architecture.md` § Storage boot sequence: clone `DATA_REPO_URL` at
 * `DATA_REPO_BRANCH` if the working directory is empty, else open the
 * existing checkout. Mirrors the deploy entrypoint's clone-or-open
 * decision (`plans/deploy.md`), done here too so the service is correct
 * standalone (dev, tests) and not solely reliant on the container
 * entrypoint having run first.
 */
export async function openDataRepo(opts: OpenDataRepoOptions): Promise<DataRepoHandle> {
  const { dataDir, repoUrl, branch, log = () => {} } = opts;

  if (isEmptyDir(dataDir)) {
    if (!repoUrl) {
      throw new Error(
        `Data directory ${dataDir} is empty and no data repo URL is configured; cannot boot.`,
      );
    }
    mkdirSync(dataDir, { recursive: true });
    log(`storage: cloning data repo ${repoUrl}${branch ? ` (${branch})` : ""} into ${dataDir}`);
    await cloneInto(dataDir, repoUrl, branch);
  } else {
    log(`storage: opening existing data repo at ${dataDir}`);
  }

  // Issue #27: bring the data repo's sheet configs up to this build's before
  // anything reads or writes through them.
  const synced = await syncSheetConfigs({ dataDir });
  if (synced.length > 0) {
    log(`storage: updated sheet configs in the data repo: ${synced.join(", ")}`);
  }

  const repo = await openRepo({ gitDir: join(dataDir, ".git"), workTree: dataDir });
  const store = await openStore(repo, { validators });

  return { repo, store, dataDir };
}
