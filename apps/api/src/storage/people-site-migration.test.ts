import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { createTestDataRepo } from "./test-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
});

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`);
  return stdout;
}

function trailersOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.trim().split("\n")) {
    const match = /^([A-Za-z-]+):\s*(.*)$/u.exec(line);
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

async function boot(dataDir: string) {
  const server = Fastify();
  await server.register(app, {
    storage: { dataDir, trackerIntervalMs: 3_600_000 },
  });
  await server.ready();
  return server;
}

/**
 * The pre-site layout: a record written straight to `people/<id>.toml`, where
 * the `${{ site }}/${{ id }}` template can no longer render or read it. Written
 * with plain git, exactly as a build before sites left it behind.
 */
async function writeLegacyPerson(
  dataDir: string,
  person: { id: string; name: string; email: string; org?: string },
): Promise<void> {
  mkdirSync(join(dataDir, "people"), { recursive: true });
  const lines = [
    `email = '${person.email}'`,
    `id = '${person.id}'`,
    `name = '${person.name}'`,
    ...(person.org ? [`org = '${person.org}'`] : []),
    `source = 'crm'`,
  ];
  writeFileSync(join(dataDir, "people", `${person.id}.toml`), `${lines.join("\n")}\n`);
  await runGit(["add", "people"], dataDir);
  await runGit(
    [
      "-c",
      "user.name=legacy",
      "-c",
      "user.email=legacy@example.org",
      "commit",
      "-m",
      "legacy people",
    ],
    dataDir,
  );
}

describe("people site migration", () => {
  it("moves pre-site records to the default site in one `migrate` commit, and is a no-op on the next boot", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    await writeLegacyPerson(dataDir, {
      id: "jane-doe",
      name: "Jane Doe",
      email: "jane@example.org",
      org: "River Alliance",
    });
    await writeLegacyPerson(dataDir, {
      id: "rick-roe",
      name: "Rick Roe",
      email: "rick@example.org",
    });

    const first = await boot(dataDir);
    cleanups.push(() => first.close());

    // The records are readable again, at their new path, carrying the site.
    const jane = first.storage.readModel.getPerson("default", "jane-doe");
    expect(jane).toBeDefined();
    expect(jane?.site).toBe("default");
    expect(jane?.org).toBe("River Alliance");
    expect(first.storage.readModel.getPerson("default", "rick-roe")?.email).toBe(
      "rick@example.org",
    );

    const tree = await runGit(["ls-tree", "-r", "--name-only", "HEAD"], dataDir);
    expect(tree).toContain("people/default/jane-doe.toml");
    expect(tree).toContain("people/default/rick-roe.toml");
    expect(tree).not.toContain("people/jane-doe.toml");
    expect(tree).not.toContain("people/rick-roe.toml");

    const migrateCommit = trailersOf(await runGit(["log", "-1", "--format=%B"], dataDir));
    expect(migrateCommit.Action).toBe("migrate");
    expect(migrateCommit.Actor).toBe("system");

    const headAfterFirst = (await runGit(["rev-parse", "HEAD"], dataDir)).trim();
    await first.close();

    // Second boot: nothing left in the old layout, so nothing is committed.
    const second = await boot(dataDir);
    cleanups.push(() => second.close());
    expect((await runGit(["rev-parse", "HEAD"], dataDir)).trim()).toBe(headAfterFirst);
    expect(second.storage.readModel.getPerson("default", "jane-doe")?.name).toBe("Jane Doe");
    await second.close();
  });

  it("commits nothing on a repo that has no people at all", async () => {
    process.env.NODE_ENV = "test";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const before = (await runGit(["rev-parse", "HEAD"], dataDir)).trim();
    const server = await boot(dataDir);
    cleanups.push(() => server.close());
    expect((await runGit(["rev-parse", "HEAD"], dataDir)).trim()).toBe(before);
    await server.close();
  });
});
