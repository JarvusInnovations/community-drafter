import { DEFAULT_SITE_SLUG, type Action, type PersonRecord } from "@signatories/shared";

import type { CommitInput, CommitResult, DataStoreTx } from "./commit.ts";
import type { ReadModel } from "./read-model.ts";

type BoundCommit = <T>(
  action: Action,
  input: CommitInput,
  fn: (tx: DataStoreTx) => Promise<T>,
) => Promise<CommitResult<T>>;

export interface PeopleSiteMigrationOptions {
  readModel: ReadModel;
  commit: BoundCommit;
  /** The data repo's working directory — `git` is run in it to read the tree. */
  dataDir: string;
  log: (message: string) => void;
}

async function git(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
}

/**
 * Records still in the pre-site layout: blobs **directly under** `people/`
 * in the committed tree, which the `${{ site }}/${{ id }}` template can no
 * longer render and `queryAll` therefore cannot see.
 *
 * The tree is read with `git`, not off disk: gitsheets writes land in the
 * branch ref and leave the working copy stale, so a warm data directory's
 * files are not what the store is reading.
 */
async function readLegacyPeople(dataDir: string): Promise<PersonRecord[]> {
  const listing = await git(["ls-tree", "HEAD:people"], dataDir);
  // No `people/` in the tree at all (a repo that has never had one) — nothing
  // to migrate, and not an error.
  if (listing.code !== 0) return [];

  const names: string[] = [];
  for (const line of listing.stdout.split("\n")) {
    // `<mode> <type> <hash>\t<name>`
    const [meta, name] = line.split("\t");
    if (!meta || !name) continue;
    if (!meta.split(" ")[1]?.startsWith("blob")) continue;
    if (!name.endsWith(".toml")) continue;
    names.push(name);
  }

  const records: PersonRecord[] = [];
  for (const name of names) {
    const shown = await git(["show", `HEAD:people/${name}`], dataDir);
    if (shown.code !== 0) continue;
    const parsed = Bun.TOML.parse(shown.stdout) as Partial<PersonRecord>;
    if (typeof parsed.id !== "string" || parsed.id.length === 0) continue;
    records.push({ ...parsed, site: DEFAULT_SITE_SLUG } as PersonRecord);
  }
  return records;
}

/**
 * `specs/data-model.md` § Migrating the pre-site layout: "every record
 * directly under `people/` is rewritten at `people/default/<id>.toml` with
 * `site = 'default'` and removed from the old path", in one commit
 * (`Action: migrate`, `Actor: system`).
 *
 * They all belong to the default site — an instance could not have had a
 * second site's people, because a person was instance-wide. Runs only when
 * the old layout is found, so the next boot is a no-op and running it twice
 * writes nothing.
 */
export async function migratePeopleToSites(opts: PeopleSiteMigrationOptions): Promise<void> {
  const { readModel, commit, dataDir, log } = opts;

  const legacy = await readLegacyPeople(dataDir);
  if (legacy.length === 0) return;

  await commit(
    "migrate",
    {
      actor: { kind: "system" },
      subject: `migrate: ${legacy.length} people to the default site`,
    },
    async (tx) => {
      for (const record of legacy) {
        await tx.people.upsert(record);
        // The old path is unrenderable from the record now that the template
        // names a site, so it is removed by its root-relative path instead.
        await tx.people.delete(record.id);
      }
    },
  );

  await readModel.refreshPeople();
  log(`storage: migrated ${legacy.length} people record(s) to site '${DEFAULT_SITE_SLUG}'`);
}
