import { join } from "node:path";

import type { Action, Trailers } from "@signatories/shared";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Repository } from "gitsheets";

import {
  commit as commitFn,
  type CommitInput,
  type CommitResult,
  type DataStoreTx,
} from "./commit.ts";
import {
  bootstrapOperator,
  ensureBootstrapSuperadmin,
  migrateLegacyDocuments,
} from "./operators-bootstrap.ts";
import { migratePeopleToSites } from "./people-site-migration.ts";
import { Pusher } from "./pusher.ts";
import { openDataRepo } from "./repo.ts";
import { ReadModel } from "./read-model.ts";
import type { DataStore } from "./schemas.ts";
import { OpenTracker } from "./tracker.ts";

export interface StorageDecoration {
  store: DataStore;
  /** The underlying gitsheets `Repository` — `repo.withLock`/`repo.refresh` back the `refresh` webhook. */
  repo: Repository;
  dataDir: string;
  readModel: ReadModel;
  tracker: OpenTracker;
  /**
   * The push path to the remote (`specs/architecture.md` § Storage, "Pushed
   * before acknowledged"); `null` when the data repo has no `origin`
   * (tests, a local-only dev checkout).
   */
  pusher: Pusher | null;
  /**
   * Bound `commit()` — commits, refreshes the read model incrementally,
   * then waits (bounded) for the commit to reach the remote before
   * resolving. A failed or slow push never fails the write.
   */
  commit<T>(
    action: Action,
    input: CommitInput,
    fn: (tx: DataStoreTx) => Promise<T>,
  ): Promise<CommitResult<T>>;
}

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageDecoration;
  }
}

export interface StoragePluginOptions {
  /** Override the data repo's local working-copy directory (tests). */
  dataDir?: string;
  /** Override the write-behind tracker's flush interval (tests). */
  trackerIntervalMs?: number;
  /** How long a write waits for its push before responding anyway (default 10 s). */
  pushWaitMs?: number;
  /** How long the shutdown sequence waits for its final push (default 7 s). */
  shutdownPushWaitMs?: number;
}

async function currentBranch(dataDir: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "symbolic-ref", "--short", "HEAD"], {
    cwd: dataDir,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() || null : null;
}

async function hasRemote(dataDir: string, remote: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "remote", "get-url", remote], {
    cwd: dataDir,
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

const storagePlugin: FastifyPluginAsync<StoragePluginOptions> = async (fastify, opts) => {
  const dataDir = opts.dataDir ?? join(process.cwd(), "data", "repo");

  const {
    repo,
    store,
    dataDir: resolvedDataDir,
  } = await openDataRepo({
    dataDir,
    repoUrl: fastify.config.DATA_REPO_URL,
    branch: fastify.config.DATA_REPO_BRANCH,
    log: (message) => fastify.log.info(message),
  });

  const readModel = new ReadModel(store, resolvedDataDir);
  await readModel.build();
  fastify.log.info({ ...readModel.summary() }, "storage: read model built");

  // Assigned once the boot-time commits below are made; until then a
  // commit only counts toward the backlog the first push carries.
  let pusher: Pusher | null = null;
  let shuttingDown = false;
  const pushWaitMs = opts.pushWaitMs ?? 10_000;

  const boundCommit = async <T>(
    action: Action,
    input: CommitInput,
    fn: (tx: DataStoreTx) => Promise<T>,
  ): Promise<CommitResult<T>> => {
    const result = await commitFn(store, action, input, fn);
    if (result.commitHash) {
      await readModel.applyCommit(result.trailers as Trailers);
      if (pusher) {
        pusher.notifyCommit();
        // `specs/architecture.md` § Storage: a write is acknowledged once
        // its commit is on the remote, or once the wait runs out — never
        // failed because the push did. During shutdown the final push
        // right after the flush carries it instead.
        if (!shuttingDown) await pusher.pushWithin(pushWaitMs);
      }
    }
    return result;
  };

  // `specs/behaviors/operators.md` § Bootstrap + `plans/operators-auth.md`'s
  // legacy-document migration — both boot-time, both idempotent, both
  // attributed to `system`. Must run before the gateway/routes can serve
  // any traffic, so it happens here rather than on an `onReady` hook.
  await bootstrapOperator({
    readModel,
    commit: boundCommit,
    bootstrapOperatorEmail: fastify.config.BOOTSTRAP_OPERATOR_EMAIL,
    log: (message) => fastify.log.info(message),
  });
  await ensureBootstrapSuperadmin({
    readModel,
    commit: boundCommit,
    bootstrapOperatorEmail: fastify.config.BOOTSTRAP_OPERATOR_EMAIL,
    log: (message) => fastify.log.info(message),
  });
  await migrateLegacyDocuments({
    readModel,
    commit: boundCommit,
    bootstrapOperatorEmail: fastify.config.BOOTSTRAP_OPERATOR_EMAIL,
    log: (message) => fastify.log.info(message),
  });
  // `specs/data-model.md` § Migrating the pre-site layout. Runs after the
  // sheet configs have been synced (`openDataRepo`, above), because the new
  // path template is what makes the old records unreadable in the first
  // place; idempotent, so every later boot finds nothing and commits nothing.
  await migratePeopleToSites({
    readModel,
    commit: boundCommit,
    dataDir: resolvedDataDir,
    log: (message) => fastify.log.info(message),
  });

  const tracker = new OpenTracker(
    boundCommit,
    opts.trackerIntervalMs,
    // `specs/data-model.md` → `Opened`: whether the commit about to be
    // written is recording this person's *first* open. The read model is
    // refreshed after every commit and the tracker is the only writer of
    // `first_opened_at`, so it is the same answer the transaction will see.
    (document, person) => !readModel.getParticipation(document, person)?.record.first_opened_at,
  );
  tracker.start();

  if (await hasRemote(resolvedDataDir, "origin")) {
    const branch =
      fastify.config.DATA_REPO_BRANCH || (await currentBranch(resolvedDataDir)) || "main";
    pusher = new Pusher({ dataDir: resolvedDataDir, branch, log: fastify.log });
    // Boot-time commits (sheet-config sync, bootstrap, migrations) are
    // already made; push them before serving, like any other write.
    const backlog = await pusher.countBacklog();
    if (backlog > 0) await pusher.pushWithin(pushWaitMs);
    fastify.log.info(
      { backlog, pendingCommits: pusher.status().pendingCommits },
      "storage: pusher ready",
    );
  } else {
    fastify.log.info("storage: no 'origin' remote configured; commits stay local");
  }

  const storage: StorageDecoration = {
    store,
    repo,
    dataDir: resolvedDataDir,
    readModel,
    tracker,
    pusher,
    commit: boundCommit,
  };

  fastify.decorate("storage", storage);

  // `specs/architecture.md` § Deployment, "Shutdown": by the time this
  // runs, `server.close()` has stopped taking requests and let in-flight
  // ones finish. Commit the pending open counts, then push everything
  // synchronously; `index.ts` bounds the whole sequence.
  fastify.addHook("onClose", async (instance: FastifyInstance) => {
    shuttingDown = true;
    instance.storage.tracker.stop();
    await instance.storage.tracker.flush();
    const finalPusher = instance.storage.pusher;
    if (finalPusher) {
      const outcome = await finalPusher.pushWithin(opts.shutdownPushWaitMs ?? 7_000);
      const { pendingCommits } = finalPusher.status();
      if (pendingCommits > 0) {
        instance.log.error(
          { pendingCommits, reason: outcome.reason },
          "shutdown: commits not pushed; they are lost with this instance",
        );
      } else {
        instance.log.info({ durationMs: outcome.durationMs ?? 0 }, "shutdown: pushed");
      }
    }
  });
};

export default fp(storagePlugin, "5.x");
