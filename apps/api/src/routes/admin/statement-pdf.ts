import type { FastifyPluginAsync } from "fastify";

import { paperFromQuery, sendPdf } from "../../deliverable/reply.ts";
import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { notFoundDocument } from "./context.ts";

/**
 * `specs/api/admin.md` § The deliverable. `?draft=1` forces the watermarked
 * form of a document that has already gone clean, for an operator who wants
 * a marked copy to circulate; there is deliberately no flag the other way,
 * because a clean copy of an unfinished statement is the one thing nobody
 * may produce.
 */
const adminStatementPdfRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { slug: string }; Querystring: { draft?: string } }>(
    "/documents/:slug/statement.pdf",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request, reply) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);

      const forceDraft = request.query.draft === "1" || request.query.draft === "true";
      const pdf = await fastify.deliverable.pdf(document, {
        paper: paperFromQuery(request),
        forceDraft,
      });
      return sendPdf(reply, pdf);
    },
  );
};

export default adminStatementPdfRoute;
