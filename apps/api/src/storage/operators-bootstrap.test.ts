import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../app.ts";
import { createTestDataRepo } from "./test-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
});

async function boot(dataDir: string) {
  const server = Fastify();
  await server.register(app, {
    storage: { dataDir, trackerIntervalMs: 3_600_000 },
    disablePhaseObserver: true,
  });
  await server.ready();
  return server;
}

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

/** `git log --format=%B -1` parsed into `{ Trailer: value }`. */
function trailersOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.trim().split("\n")) {
    const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

describe("operator bootstrap", () => {
  it("creates the bootstrap operator when the sheet is empty and BOOTSTRAP_OPERATOR_EMAIL is set", async () => {
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_OPERATOR_EMAIL = "founder@example.org";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const server = await boot(dataDir);
    cleanups.push(() => void server.close());

    const operator = server.storage.readModel.getOperatorByEmail("founder@example.org");
    expect(operator).toBeDefined();
    expect(operator?.active).toBe(true);
    expect(operator?.kind).toBe("person");

    const body = await runGit(["log", "-1", "--format=%B"], dataDir);
    const trailers = trailersOf(body);
    expect(trailers.Action).toBe("operator-add");
    expect(trailers.Actor).toBe("system");
  });

  it("does nothing when BOOTSTRAP_OPERATOR_EMAIL is unset", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const server = await boot(dataDir);
    cleanups.push(() => void server.close());

    expect(server.storage.readModel.listOperators()).toHaveLength(0);
  });

  it("does not re-bootstrap once the sheet is non-empty, even if BOOTSTRAP_OPERATOR_EMAIL is set to someone else", async () => {
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_OPERATOR_EMAIL = "first@example.org";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const first = await boot(dataDir);
    expect(first.storage.readModel.listOperators()).toHaveLength(1);
    await first.close();

    process.env.BOOTSTRAP_OPERATOR_EMAIL = "second@example.org";
    const second = await boot(dataDir);
    cleanups.push(() => void second.close());

    const operators = second.storage.readModel.listOperators();
    expect(operators).toHaveLength(1);
    expect(operators[0]?.email).toBe("first@example.org");
  });
});

describe("legacy document migration", () => {
  it("backfills created_by/operators on a document that predates the operators sheet, in one commit", async () => {
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_OPERATOR_EMAIL = "migrator@example.org";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    // Simulate a document written before this plan: `created_by`/
    // `operators` are now required on write (`.gitsheets/documents.toml`),
    // so the only way to produce a record that predates them is to write
    // the file and commit it directly with git, bypassing gitsheets
    // entirely — exactly the shape a hand-edited legacy repo would have.
    const documentsDir = join(dataDir, "documents");
    mkdirSync(documentsDir, { recursive: true });
    writeFileSync(
      join(documentsDir, "legacy-doc.md"),
      '+++\nslug = "legacy-doc"\nstate = "draft"\ntitle = "Legacy Doc"\n+++\n\n',
    );
    await runGit(["add", "documents/legacy-doc.md"], dataDir);
    await runGit(
      [
        "-c",
        "user.name=legacy",
        "-c",
        "user.email=legacy@community-drafter.local",
        "commit",
        "-m",
        "create: legacy-doc",
        "--trailer",
        "Action: create",
        "--trailer",
        "Document: legacy-doc",
        "--trailer",
        "Actor: legacy-admin",
      ],
      dataDir,
    );

    const server = await boot(dataDir);
    cleanups.push(() => void server.close());

    const entry = server.storage.readModel.getDocument("legacy-doc");
    expect(entry?.record.created_by).toBe("migrator@example.org");
    expect(entry?.record.operators).toEqual(["migrator@example.org"]);

    const log = await runGit(["log", "--format=%H"], dataDir);
    const hashes = log.trim().split("\n");
    let migrationCommits = 0;
    for (const hash of hashes) {
      const body = await runGit(["show", "-s", "--format=%B", hash], dataDir);
      const trailers = trailersOf(body);
      if (trailers.Action === "settings" && trailers.Actor === "system") migrationCommits += 1;
    }
    // Exactly one migration commit, even though it touches the document
    // record — "in ONE commit" per the plan.
    expect(migrationCommits).toBe(1);
  });

  it("leaves an already-migrated document alone on a later boot (idempotent)", async () => {
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_OPERATOR_EMAIL = "migrator@example.org";
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const first = await boot(dataDir);
    await first.close();

    const commitsAfterFirstBoot = (await runGit(["rev-list", "--count", "HEAD"], dataDir)).trim();

    const second = await boot(dataDir);
    cleanups.push(() => void second.close());

    const commitsAfterSecondBoot = (await runGit(["rev-list", "--count", "HEAD"], dataDir)).trim();
    expect(commitsAfterSecondBoot).toBe(commitsAfterFirstBoot);
  });
});
