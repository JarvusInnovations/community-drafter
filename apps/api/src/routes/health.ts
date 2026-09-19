import type { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, _reply) => {
    const { readModel, pushDaemon } = fastify.storage;

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "community-drafter-api",
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
