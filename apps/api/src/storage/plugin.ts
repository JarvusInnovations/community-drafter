import { join } from "node:path";

import type { Action, Trailers } from "@signatories/shared";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { PushDaemon, Repository } from "gitsheets";

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
  pushDaemon: PushDaemon | null;
  /** Bound `commit()` — commits, then refreshes the read model incrementally. */
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

  const boundCommit = async <T>(
    action: Action,
    input: CommitInput,
    fn: (tx: DataStoreTx) => Promise<T>,
  ): Promise<CommitResult<T>> => {
    const result = await commitFn(store, action, input, fn);
    if (result.commitHash) {
      await readModel.applyCommit(result.trailers as Trailers);
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

  let pushDaemon: PushDaemon | null = null;
  if (await hasRemote(resolvedDataDir, "origin")) {
    pushDaemon = await repo.startPushDaemon({
      remote: "origin",
      branch: fastify.config.DATA_REPO_BRANCH,
    });

    const status = pushDaemon.status();
    fastify.log.info(
      { pendingCommits: status.pendingCommits },
      "storage: push daemon started (startup backlog check complete)",
    );

    pushDaemon.on("push", ({ commit, durationMs }) => {
      fastify.log.info({ commit, durationMs }, "storage: pushed commit");
    });
    pushDaemon.on("error", ({ commit, err, attempt, reason }) => {
      if (reason === "non-fast-forward") {
        fastify.log.error(
          { commit, err: String(err) },
          "storage: push daemon diverged from remote",
        );
      } else {
        fastify.log.warn({ commit, err: String(err), attempt }, "storage: push retry");
      }
    });
  } else {
    fastify.log.info("storage: no 'origin' remote configured; push daemon not started");
  }

  const storage: StorageDecoration = {
    store,
    repo,
    dataDir: resolvedDataDir,
    readModel,
    tracker,
    pushDaemon,
    commit: boundCommit,
  };

  fastify.decorate("storage", storage);

  fastify.addHook("onClose", async (instance: FastifyInstance) => {
    instance.storage.tracker.stop();
    await instance.storage.tracker.flush();
    if (instance.storage.pushDaemon) {
      await instance.storage.pushDaemon.stop({ timeoutMs: 30_000 });
    }
  });
};

export default fp(storagePlugin, "5.x");
