import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";
import Fastify from "fastify";

import { app } from "../../app.ts";
import { commit } from "../../storage/commit.ts";
import { openDataRepo } from "../../storage/repo.ts";
import { createTestDataRepoWithRemote } from "../../storage/test-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  delete process.env.DATA_REPO_WEBHOOK_SECRET;
});

// `bun test` shares one process across files; another file's
// `buildTestServer()` (`routes/test-support.ts`) sets
// `BOOTSTRAP_OPERATOR_EMAIL` process-wide and never unsets it. Left set, it
// would make *this* file's plain `Fastify()` + `app` boots create their own
// bootstrap-operator commit locally that was never pushed to the shared
// remote — a spurious divergence that has nothing to do with what this file
// is testing. Every test here boots its own server, so clear it up front.
delete process.env.BOOTSTRAP_OPERATOR_EMAIL;

const WEBHOOK_SECRET = "webhook-test-secret";

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`);
  return stdout.trim();
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
}

/** `POST /admin/api/refresh` requires a `webhook` capability signature — always sent with an empty JSON body here. */
async function callRefresh(server: import("fastify").FastifyInstance) {
  const body = "{}";
  return server.inject({
    method: "POST",
    url: "/admin/api/refresh",
    headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
    payload: body,
  });
}

/**
 * `refresh_busy` is the spec's "respond 409 and let the caller retry"
 * (`specs/behaviors/operators.md`) whenever commits are waiting to be
 * pushed, so this helper retries it like a caller would rather than
 * assuming a boot never leaves anything pending.
 */
async function callRefreshRetryingBusy(server: import("fastify").FastifyInstance, attempts = 20) {
  let response = await callRefresh(server);
  for (
    let attempt = 1;
    attempt < attempts && response.json()?.error === "refresh_busy";
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    response = await callRefresh(server);
  }
  return response;
}

describe("POST /admin/api/refresh", () => {
  it("fast-forwards from a push made by a second clone, and rebuilds the read model", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
    process.env.DATA_REPO_WEBHOOK_SECRET = WEBHOOK_SECRET;

    // Clone A: the running server's own working copy.
    const { remoteDir, dataDir, cleanup: cleanupA } = await createTestDataRepoWithRemote();
    cleanups.push(cleanupA);

    // Clone B: stands in for a hand edit pushed from elsewhere (e.g.
    // `gitsheets-axi`) while the server is running.
    const cloneB = mkdtempSync(join(tmpdir(), "cd-refresh-cloneb-"));
    cleanups.push(() => rmSync(cloneB, { recursive: true, force: true }));
    await runGit(["clone", remoteDir, cloneB], tmpdir());
    const { store: storeB } = await openDataRepo({ dataDir: cloneB });
    await commit(
      storeB,
      "create",
      {
        actor: { kind: "system" },
        subject: "create: out-of-band-doc",
        document: "out-of-band-doc",
      },
      async (tx) => {
        await tx.documents.upsert({
          slug: "out-of-band-doc",
          title: "Out Of Band",
          state: "draft",
          body: "",
          created_by: "hand-edit@example.org",
          operators: ["hand-edit@example.org"],
        });
      },
    );
    await runGit(["push", "origin", "main"], cloneB);
    const remoteHead = await runGit(["rev-parse", "refs/heads/main"], cloneB);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
    });
    await server.ready();
    cleanups.push(() => void server.close());
    // Not visible until refreshed.
    expect(server.storage.readModel.getDocument("out-of-band-doc")).toBeUndefined();

    const response = await callRefreshRetryingBusy(server);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rebuilt).toBe(true);
    expect(body.head_after).toBe(remoteHead);
    expect(body.head_before).not.toBe(body.head_after);

    expect(server.storage.readModel.getDocument("out-of-band-doc")).toBeDefined();
  }, 20_000);

  it("responds rebuilt: false, head_before === head_after when already up to date", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
    process.env.DATA_REPO_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
    });
    await server.ready();
    cleanups.push(() => void server.close());
    const response = await callRefreshRetryingBusy(server);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rebuilt).toBe(false);
    expect(body.head_before).toBe(body.head_after);
  }, 20_000);

  it("409 refresh_busy while there are commits it can't push", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
    process.env.DATA_REPO_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);
    // Break the remote so every push attempt fails and `pendingCommits`
    // never drains back to 0 within this test.
    await runGit(["remote", "set-url", "origin", "/nonexistent/does-not-exist"], dataDir);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
    });
    await server.ready();
    cleanups.push(() => void server.close());

    await server.storage.commit(
      "settings",
      { actor: { kind: "system" }, subject: "settings: pending-doc created" },
      async (tx) => {
        await tx.documents.upsert({
          slug: "pending-doc",
          title: "Pending Doc",
          state: "draft",
          body: "",
          created_by: "x@example.org",
          operators: ["x@example.org"],
        });
      },
    );

    // The write waited for its push, which failed; the commit stays pending.
    expect(server.storage.pusher?.status().pendingCommits).toBeGreaterThan(0);

    const response = await callRefresh(server);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("refresh_busy");
  }, 20_000);

  it("401s a request with no/invalid signature", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.BOOTSTRAP_OPERATOR_EMAIL;
    process.env.DATA_REPO_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const { dataDir, cleanup } = await createTestDataRepoWithRemote();
    cleanups.push(cleanup);

    const server = Fastify();
    await server.register(app, {
      storage: { dataDir, trackerIntervalMs: 3_600_000 },
    });
    await server.ready();
    cleanups.push(() => void server.close());

    const response = await server.inject({ method: "POST", url: "/admin/api/refresh" });
    expect(response.statusCode).toBe(401);
  }, 20_000);
});
