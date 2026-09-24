import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { openDataRepo } from "./repo.ts";
import { createTestDataRepo, createTestDataRepoWithRemote } from "./test-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("openDataRepo", () => {
  it("opens an existing non-empty data repo without cloning", async () => {
    const { dataDir, cleanup } = await createTestDataRepo();
    cleanups.push(cleanup);

    const { store, dataDir: resolved } = await openDataRepo({ dataDir });
    expect(resolved).toBe(dataDir);
    const docs = await store.documents.queryAll();
    expect(docs).toEqual([]);
  });

  it("clones the configured remote when the data directory is empty", async () => {
    const { remoteDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);

    const localDir = mkdtempSync(join(tmpdir(), "cd-storage-boot-"));
    rmSync(localDir, { recursive: true, force: true }); // must not exist / be empty for the clone path
    cleanups.push(() => rmSync(localDir, { recursive: true, force: true }));

    const { store, dataDir } = await openDataRepo({
      dataDir: localDir,
      repoUrl: remoteDir,
      branch: "main",
    });
    expect(existsSync(join(dataDir, ".gitsheets", "documents.toml"))).toBe(true);
    await expect(store.documents.queryAll()).resolves.toEqual([]);
  });

  it("throws when the data directory is empty and no repo URL is configured", async () => {
    const localDir = mkdtempSync(join(tmpdir(), "cd-storage-empty-"));
    cleanups.push(() => rmSync(localDir, { recursive: true, force: true }));

    await expect(openDataRepo({ dataDir: localDir })).rejects.toThrow(/empty/);
  });
});
