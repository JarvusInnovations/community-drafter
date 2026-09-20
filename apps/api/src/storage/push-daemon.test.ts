import { afterEach, describe, expect, it } from "bun:test";

import { commit } from "./commit.ts";
import { openDataRepo } from "./repo.ts";
import { createTestDataRepoWithRemote } from "./test-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function revParse(dataDir: string, ref: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", ref], {
    cwd: dataDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

describe("push daemon", () => {
  it("pushes each commit to the remote within 10s in a local two-repo setup", async () => {
    const { dataDir, remoteDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);

    const { repo, store } = await openDataRepo({ dataDir });
    const daemon = await repo.startPushDaemon({ remote: "origin", branch: "main" });
    cleanups.push(() => void daemon.stop({ timeoutMs: 5_000 }));

    await commit(
      store,
      "create",
      { actor: { kind: "system" }, subject: "create: doc", document: "doc" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc",
          title: "Doc",
          state: "draft",
          body: "hello",
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    const localHead = await revParse(dataDir, "HEAD");

    const deadline = Date.now() + 10_000;
    let remoteHead = "";
    while (Date.now() < deadline) {
      remoteHead = await revParse(remoteDir, "refs/heads/main");
      if (remoteHead === localHead) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(remoteHead).toBe(localHead);

    await daemon.stop({ timeoutMs: 5_000 });
  }, 15_000);

  it("queues the startup backlog when commits already exist ahead of the remote", async () => {
    const { dataDir, remoteDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);

    // Make a local commit before the daemon (and hence any push) exists.
    const { repo, store } = await openDataRepo({ dataDir });
    await commit(
      store,
      "create",
      { actor: { kind: "system" }, subject: "create: doc", document: "doc" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "doc",
          title: "Doc",
          state: "draft",
          body: "hello",
          created_by: "team@example.org",
          operators: ["team@example.org"],
        });
      },
    );

    const remoteHeadBefore = await revParse(remoteDir, "refs/heads/main");
    const localHead = await revParse(dataDir, "HEAD");
    expect(remoteHeadBefore).not.toBe(localHead); // remote is behind before the daemon starts

    const daemon = await repo.startPushDaemon({ remote: "origin", branch: "main" });
    cleanups.push(() => void daemon.stop({ timeoutMs: 5_000 }));

    const deadline = Date.now() + 10_000;
    let remoteHead = "";
    while (Date.now() < deadline) {
      remoteHead = await revParse(remoteDir, "refs/heads/main");
      if (remoteHead === localHead) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(remoteHead).toBe(localHead);
    await daemon.stop({ timeoutMs: 5_000 });
  }, 15_000);
});
