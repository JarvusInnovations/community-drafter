import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import envPlugin from "./plugins/env.ts";
import healthRoutes from "./routes/health.ts";
import storagePlugin, { type StoragePluginOptions } from "./storage/plugin.ts";

export interface AppOptions {
  /** Test-only override for where/how the storage plugin opens its data repo. */
  storage?: StoragePluginOptions;
}

export const app: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  // 1. Register environment configuration FIRST
  await fastify.register(envPlugin);

  // Update log level from config
  fastify.log.level = fastify.config.LOG_LEVEL;

  // 2. Storage: the data repo, read model, tracker, push daemon.
  await fastify.register(storagePlugin, opts.storage ?? {});

  // 3. Health check — reports storage readiness. No other routes yet
  //    (→ api-core).
  await fastify.register(healthRoutes, { prefix: "/_health" });

  fastify.addHook("onReady", async () => {
    fastify.log.info("community-drafter API initialized");
    fastify.log.info(`Environment: ${fastify.config.NODE_ENV}`);
  });
};

export default fp(app, "5.x");
