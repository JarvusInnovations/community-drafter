import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

/**
 * `specs/api/conventions.md`: "Every response carries `X-Request-Id`; the
 * id is also written as a commit trailer on any write it causes." Honoring
 * an incoming header lets a caller correlate its own retries; generating
 * one when absent means every response — including ones from `curl` — gets
 * the header.
 */
declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}

const requestContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request, reply) => {
    const header = request.headers["x-request-id"];
    const incoming = Array.isArray(header) ? header[0] : header;
    request.requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
    reply.header("X-Request-Id", request.requestId);
  });
};

export default fp(requestContextPlugin, "5.x");
