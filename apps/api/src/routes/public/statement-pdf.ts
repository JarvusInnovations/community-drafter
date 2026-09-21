import type { FastifyPluginAsync } from "fastify";

import { paperFromQuery, sendPdf } from "../../deliverable/reply.ts";
import { ApiError } from "../../errors.ts";
import { PUBLIC_ROUTE } from "../../gateway/gateway.ts";
import { FixedWindowLimiter } from "../../gateway/rate-limit.ts";
import { PUBLIC_NOT_FOUND, loadPublicDocument } from "./context.ts";

/**
 * `specs/api/conventions.md` § Rate limits: "10 per minute per source
 * address. It is the only anonymous route whose cost is a headless browser
 * rather than a map lookup." Exported so tests can reset the window without
 * a fresh module load, exactly as the gateway's two limiters are.
 */
export const statementPdfLimiter = new FixedWindowLimiter(10, 60_000);

/**
 * `specs/screens/deliverable.md` § Routes, the public door. It carries one
 * gate the rest of `/d/:slug/*` does not: `audience = closed` 404s here
 * while the same document's text stays readable one route over. Who may
 * read the working draft (`public_access`) and who the finished statement
 * is for (`audience`) are different questions (`specs/data-model.md` §
 * Audience), and this is the route where the second one bites.
 */
const statementPdfRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { slug: string } }>(
    "/statement.pdf",
    { config: PUBLIC_ROUTE },
    async (request, reply) => {
      if (!statementPdfLimiter.hit(request.ip)) {
        throw new ApiError("rate_limited", "Too many requests. Try again in a minute.");
      }

      const { document } = loadPublicDocument(fastify, request);
      if ((document.record.audience ?? "closed") !== "public") throw PUBLIC_NOT_FOUND;

      const pdf = await fastify.deliverable.pdf(document, { paper: paperFromQuery(request) });
      return sendPdf(reply, pdf);
    },
  );
};

export default statementPdfRoute;
