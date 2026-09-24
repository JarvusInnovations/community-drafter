import { afterEach, describe, expect, it } from "bun:test";

import { buildTestServer, seedDocument, seedParticipant } from "../routes/test-support.ts";

/**
 * `specs/architecture.md` § Storage ("Pushed before acknowledged") and
 * § Deployment ("Shutdown"), against a bare local repo standing in for
 * GitHub. The instance can be stopped whenever it is idle and its disk goes
 * with it, so what matters is what the remote holds.
 */
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
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

describe("pushed before acknowledged", () => {
  it("a write's commit is on the remote when the write resolves", async () => {
    const { server, dataDir, remoteDir, cleanup } = await buildTestServer({ withRemote: true });
    cleanups.push(cleanup);

    await seedDocument(server, { slug: "doc" });
    expect(await git(["rev-parse", "refs/heads/main"], remoteDir!)).toBe(
      await git(["rev-parse", "HEAD"], dataDir),
    );
    expect(server.storage.pusher?.status().pendingCommits).toBe(0);

    await server.close();
  });

  it("a write still succeeds when the push fails, and stays pending", async () => {
    const { server, dataDir, cleanup } = await buildTestServer({ withRemote: true });
    cleanups.push(cleanup);
    await git(["remote", "set-url", "origin", "/nonexistent/remote.git"], dataDir);

    await seedDocument(server, { slug: "doc" });
    expect(server.storage.readModel.getDocument("doc")).toBeDefined();
    const status = server.storage.pusher!.status();
    expect(status.pendingCommits).toBe(1);
    expect(status.lastError).not.toBeNull();

    const health = await server.inject({ method: "GET", url: "/_health" });
    expect(health.json().storage.push.pendingCommits).toBe(1);

    await server.close();
  });
});

describe("shutdown", () => {
  it("commits pending opens and pushes every unpushed commit before close() resolves", async () => {
    const { server, dataDir, remoteDir, cleanup } = await buildTestServer({ withRemote: true });
    cleanups.push(cleanup);
    await seedDocument(server, { slug: "doc" });
    await seedParticipant(server, { document: "doc", person: "jane", token: "j".repeat(24) });

    // GitHub is unreachable for a while: a write lands locally only.
    await git(["remote", "set-url", "origin", "/nonexistent/remote.git"], dataDir);
    await seedParticipant(server, { document: "doc", person: "rick", token: "r".repeat(24) });
    expect(server.storage.pusher!.status().pendingCommits).toBe(1);
    // And an open is waiting in the write-behind batch.
    server.storage.tracker.record("doc", "jane");
    expect(server.storage.tracker.pendingCount()).toBe(1);

    // It comes back just before Cloud Run stops the idle instance.
    await git(["remote", "set-url", "origin", remoteDir!], dataDir);
    const started = Date.now();
    await server.close();
    expect(Date.now() - started).toBeLessThan(9_000);

    const localHead = await git(["rev-parse", "HEAD"], dataDir);
    expect(await git(["rev-parse", "refs/heads/main"], remoteDir!)).toBe(localHead);
    const actions = await git(
      ["log", "-3", "--format=%(trailers:key=Action,valueonly)", "main"],
      remoteDir!,
    );
    expect(actions.split(/\s+/u).filter(Boolean)[0]).toBe("track");
    expect(server.storage.pusher!.status().pendingCommits).toBe(0);
  }, 20_000);
});
