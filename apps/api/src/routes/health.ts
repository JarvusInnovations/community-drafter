import type { FastifyPluginAsync } from "fastify";

import { PUBLIC_ROUTE } from "../gateway/gateway.ts";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { config: PUBLIC_ROUTE }, async (_request, _reply) => {
    const { readModel, pusher } = fastify.storage;

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "signatories-api",
      environment: fastify.config.NODE_ENV,
      storage: {
        ready: true,
        ...readModel.summary(),
        // `specs/architecture.md` § Storage: pending commits and the last
        // push error, so an unpushed backlog is visible before a shutdown.
        push: pusher ? pusher.status() : null,
      },
    };
  });
};

export default healthRoutes;
