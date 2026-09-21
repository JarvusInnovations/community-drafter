import type { FastifyPluginAsync } from "fastify";

import { PUBLIC_ROUTE } from "../gateway/gateway.ts";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { config: PUBLIC_ROUTE }, async (_request, _reply) => {
    const { readModel, pushDaemon } = fastify.storage;

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "signatories-api",
      environment: fastify.config.NODE_ENV,
      storage: {
        ready: true,
        ...readModel.summary(),
        pushDaemon: pushDaemon ? pushDaemon.status() : null,
      },
    };
  });
};

export default healthRoutes;
