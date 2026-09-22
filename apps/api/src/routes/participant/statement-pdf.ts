import type { FastifyPluginAsync } from "fastify";

import { citationsFromQuery, paperFromQuery, sendPdf } from "../../deliverable/reply.ts";
import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { loadParticipantContext } from "./context.ts";

/**
 * `specs/api/participant.md` § `GET /i/:token/api/statement.pdf`. No
 * `audience` check: the holder of this link can already read every word of
 * the statement and every name on it from their own screen, so a gate that
 * only governs what strangers may download has nothing to add here.
 */
const participantStatementPdfRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/statement.pdf", { config: PARTICIPANT_ROUTE }, async (request, reply) => {
    const { document } = loadParticipantContext(fastify, request);
    const pdf = await fastify.deliverable.pdf(document, {
      paper: paperFromQuery(request),
      citations: citationsFromQuery(request),
    });
    return sendPdf(reply, pdf);
  });
};

export default participantStatementPdfRoute;
