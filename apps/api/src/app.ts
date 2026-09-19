import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import envPlugin from "./plugins/env.ts";
import healthRoutes from "./routes/health.ts";

export const app: FastifyPluginAsync = async (fastify) => {
  // 1. Register environment configuration FIRST
  await fastify.register(envPlugin);

  // Update log level from config
  fastify.log.level = fastify.config.LOG_LEVEL;

  // 2. Health check only — no other routes, no storage, per plans/workspace-bootstrap.md
  await fastify.register(healthRoutes, { prefix: "/_health" });

  fastify.addHook("onReady", async () => {
    fastify.log.info("community-drafter API initialized");
    fastify.log.info(`Environment: ${fastify.config.NODE_ENV}`);
  });
};

export default fp(app, "5.x");
