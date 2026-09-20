import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_NAMES = ["documents", "operators", "people", "participations", "submissions"] as const;

/**
 * `specs/architecture.md` repo layout: ".gitsheets/ sheet configs, copied
 * into the data repo on init." This module's own directory is
 * `apps/api/src/storage/`; the source configs live at the monorepo root's
 * `.gitsheets/`, four levels up.
 */
const DEFAULT_SOURCE_CONFIG_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".gitsheets",
);

export interface InitDataRepoOptions {
  /** The local working copy of the (already cloned/created) data repo. */
  dataDir: string;
  /** Override for tests; defaults to this monorepo's own `.gitsheets/`. */
  sourceConfigDir?: string;
  author?: { name: string; email: string };
}

export interface InitDataRepoResult {
  commitHash: string;
  sheets: readonly string[];
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr || stdout}`);
  }
  return stdout;
}

/**
 * First-boot helper (`specs/api/admin.md`: `POST /init-data-repo`; route
 * wiring lands in `api-core`). Given an empty data repo, writes and commits
 * the four sheet configs in one commit. Refuses if any of the four already
 * exists, so it can never clobber a live sheet's config.
 */
export async function initDataRepo(opts: InitDataRepoOptions): Promise<InitDataRepoResult> {
  const {
    dataDir,
    sourceConfigDir = DEFAULT_SOURCE_CONFIG_DIR,
    author = { name: "community-drafter", email: "bootstrap@community-drafter.local" },
  } = opts;

  const targetConfigDir = join(dataDir, ".gitsheets");
  for (const name of SHEET_NAMES) {
    const target = join(targetConfigDir, `${name}.toml`);
    if (existsSync(target)) {
      throw new Error(
        `initDataRepo: refusing — ${name}.toml already exists in the data repo at ${target}`,
      );
    }
  }

  mkdirSync(targetConfigDir, { recursive: true });
  for (const name of SHEET_NAMES) {
    const source = join(sourceConfigDir, `${name}.toml`);
    const contents = readFileSync(source, "utf8");
    writeFileSync(join(targetConfigDir, `${name}.toml`), contents);
  }

  await runGit(["add", ".gitsheets"], dataDir);
  await runGit(
    [
      "-c",
      `user.name=${author.name}`,
      "-c",
      `user.email=${author.email}`,
      "commit",
      "-m",
      "chore(gitsheets): initialize documents, operators, people, participations, submissions sheets",
    ],
    dataDir,
  );

  const commitHash = (await runGit(["rev-parse", "HEAD"], dataDir)).trim();
  return { commitHash, sheets: SHEET_NAMES };
}

export interface SyncSheetConfigsOptions {
  dataDir: string;
  sourceConfigDir?: string;
  author?: { name: string; email: string };
}

/**
 * Boot-time sheet-config migration (issue #27): an existing data repo whose
 * `.gitsheets/<name>.toml` files are missing or differ from this build's
 * gets them written and committed in one commit, so a schema addition in
 * the app (a new optional field) never fails validation against a stale
 * config in the data repo. gitsheets reads configs from the committed
 * tree, so the commit is what makes the change effective. Returns the
 * sheets it changed; an up-to-date repo is a no-op with no commit.
 */
export async function syncSheetConfigs(opts: SyncSheetConfigsOptions): Promise<string[]> {
  const {
    dataDir,
    sourceConfigDir = DEFAULT_SOURCE_CONFIG_DIR,
    author = { name: "community-drafter", email: "bootstrap@community-drafter.local" },
  } = opts;
  const targetConfigDir = join(dataDir, ".gitsheets");
  mkdirSync(targetConfigDir, { recursive: true });

  const changed: string[] = [];
  for (const name of SHEET_NAMES) {
    const contents = readFileSync(join(sourceConfigDir, `${name}.toml`), "utf8");
    const target = join(targetConfigDir, `${name}.toml`);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current !== contents) {
      writeFileSync(target, contents);
      changed.push(name);
    }
  }
  if (changed.length === 0) return changed;

  await runGit(["add", ".gitsheets"], dataDir);
  await runGit(
    [
      "-c",
      `user.name=${author.name}`,
      "-c",
      `user.email=${author.email}`,
      "commit",
      "-m",
      `chore(gitsheets): update ${changed.join(", ")} sheet config`,
    ],
    dataDir,
  );
  return changed;
}
