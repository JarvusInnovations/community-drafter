import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { PUBLIC_ROUTE } from "../../gateway/gateway.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { loadPublicDocument } from "./context.ts";

interface CompareParams {
  slug: string;
}

interface CompareQuery {
  from?: string;
  to?: string;
}

/**
 * `specs/screens/public-and-embed.md` public compare, identical semantics
 * to `routes/participant/compare.ts` (`specs/behaviors/versioning.md` §
 * Diff: "Default comparison is latest vs previous") — the redline HTML
 * carries no person data either way.
 */
const compareRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: CompareParams; Querystring: CompareQuery }>(
    "/compare",
    { config: PUBLIC_ROUTE },
    async (request) => {
      const { document } = loadPublicDocument(fastify, request);
      const latest = resolveVersion(document);

      const toNumber = request.query.to !== undefined ? Number(request.query.to) : latest.number;
      const defaultFrom = Math.max(1, toNumber - 1);
      const fromNumber =
        request.query.from !== undefined ? Number(request.query.from) : defaultFrom;

      const from = resolveVersion(document, fromNumber);
      const to = resolveVersion(document, toNumber);
      if (from.number === to.number) {
        throw new ApiError("invalid_request", "from and to must name different versions.");
      }

      const fromRendered = fastify.rendering.render(from.commit, from.body);
      const toRendered = fastify.rendering.render(to.commit, to.body);
      const diff = fastify.rendering.diff(
        from.commit,
        to.commit,
        fromRendered.blocks,
        toRendered.blocks,
      );

      return { from: from.number, to: to.number, summary: diff.summary, blocks: diff.blocks };
    },
  );
};

export default compareRoute;
