import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { commit } from "./commit.ts";
import { Pusher, runGit } from "./pusher.ts";
import { openDataRepo } from "./repo.ts";
import { createTestDataRepoWithRemote } from "./test-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function makeCommit(dataDir: string, slug: string): Promise<void> {
  const { store } = await openDataRepo({ dataDir });
  await commit(
    store,
    "create",
    { actor: { kind: "system" }, subject: `create: ${slug}`, document: slug },
    async (tx) => {
      await tx.documents.upsert({
        slug,
        title: slug,
        state: "draft",
        body: "hello",
        created_by: "team@example.org",
        operators: ["team@example.org"],
      });
    },
  );
}

describe("Pusher", () => {
  it("pushes pending commits to the remote and reports nothing pending after", async () => {
    const { dataDir, remoteDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);
    const pusher = new Pusher({ dataDir, branch: "main" });

    await makeCommit(dataDir, "doc");
    pusher.notifyCommit();
    expect(pusher.status().pendingCommits).toBe(1);

    const outcome = await pusher.push();
    expect(outcome.ok).toBe(true);
    expect(await git(["rev-parse", "refs/heads/main"], remoteDir)).toBe(
      await git(["rev-parse", "HEAD"], dataDir),
    );
    expect(pusher.status().pendingCommits).toBe(0);
    expect(pusher.status().lastPushMs).toBeGreaterThanOrEqual(0);

    // Nothing pending: no `git push` runs at all.
    expect((await pusher.push()).skipped).toBe(true);
  });

  it("counts commits already ahead of the remote at boot as backlog", async () => {
    const { dataDir, remoteDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);
    await makeCommit(dataDir, "doc-a");
    await makeCommit(dataDir, "doc-b");

    const pusher = new Pusher({ dataDir, branch: "main" });
    expect(await pusher.countBacklog()).toBe(2);
    expect((await pusher.push()).ok).toBe(true);
    expect(await git(["rev-parse", "refs/heads/main"], remoteDir)).toBe(
      await git(["rev-parse", "HEAD"], dataDir),
    );
  });

  it("serializes overlapping pushes", async () => {
    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);
    const pusher = new Pusher({ dataDir, branch: "main" });
    await makeCommit(dataDir, "doc");
    pusher.notifyCommit();

    const outcomes = await Promise.all([pusher.push(), pusher.push(), pusher.push()]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    // The first carried the commit; the rest found nothing to send.
    expect(outcomes.filter((o) => o.skipped).length).toBe(2);
  });

  it("keeps a failed push pending with its error, and a later push clears it", async () => {
    const { dataDir, remoteDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);
    const pusher = new Pusher({ dataDir, branch: "main" });
    await git(["remote", "set-url", "origin", "/nonexistent/remote.git"], dataDir);

    await makeCommit(dataDir, "doc");
    pusher.notifyCommit();
    const failed = await pusher.push();
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe("unknown");
    expect(pusher.status().pendingCommits).toBe(1);
    expect(pusher.status().lastError?.message).toBeTruthy();
    expect(pusher.diverged()).toBe(false);

    await git(["remote", "set-url", "origin", remoteDir], dataDir);
    expect((await pusher.push()).ok).toBe(true);
    expect(pusher.status()).toMatchObject({ pendingCommits: 0, lastError: null });
  });

  it("classifies a rejected non-fast-forward as divergence", async () => {
    const { dataDir, remoteDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);
    // Someone else writes to the remote: the single writer has been contradicted.
    const other = mkdtempSync(join(tmpdir(), "cd-pusher-other-"));
    cleanups.push(() => rmSync(other, { recursive: true, force: true }));
    await git(["clone", remoteDir, other], tmpdir());
    await makeCommit(other, "elsewhere");
    await git(["push", "origin", "main"], other);

    const pusher = new Pusher({ dataDir, branch: "main" });
    await makeCommit(dataDir, "here");
    pusher.notifyCommit();
    const outcome = await pusher.push();
    expect(outcome).toMatchObject({ ok: false, reason: "non-fast-forward" });
    expect(pusher.diverged()).toBe(true);
  });

  it("pushWithin stops waiting at its bound without failing the caller", async () => {
    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);
    const pusher = new Pusher({ dataDir, branch: "main" });
    await makeCommit(dataDir, "doc");
    pusher.notifyCommit();
    const outcome = await pusher.pushWithin(0);
    expect(outcome).toMatchObject({ ok: false, reason: "timeout" });
    // The push itself carried on.
    expect((await pusher.push()).ok).toBe(true);
    expect(pusher.status().pendingCommits).toBe(0);
  });
});

describe("runGit", () => {
  it("returns a failed result instead of throwing when the working copy is gone", async () => {
    const result = await runGit(["status"], "/nonexistent/removed-data-dir");
    expect(result.code).toBe(-1);
    expect(result.stderr).toBeTruthy();
  });
});

describe("Pusher with its repo gone", () => {
  it("reports a classified failure, never an exception, when the data dir was removed", async () => {
    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    const pusher = new Pusher({ dataDir, branch: "main" });
    await makeCommit(dataDir, "doc");
    pusher.notifyCommit();
    cleanup();

    const outcome = await pusher.push();
    expect(outcome).toMatchObject({ ok: false, reason: "unknown" });
    expect(pusher.status().pendingCommits).toBe(1);
    expect(pusher.status().lastError?.message).toBeTruthy();
    await pusher.idle();
  });
});
