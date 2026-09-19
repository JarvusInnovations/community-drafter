import type { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, _reply) => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "community-drafter-api",
      environment: fastify.config.NODE_ENV,
    };
  });
};

export default healthRoutes;
