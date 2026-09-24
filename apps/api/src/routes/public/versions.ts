import type { FastifyPluginAsync } from "fastify";

import { citationsFromQuery } from "../../lib/citations.ts";
import { PUBLIC_ROUTE } from "../../gateway/gateway.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { loadPublicDocument } from "./context.ts";

interface VersionParams {
  slug: string;
  n: string;
}

interface VersionQuery {
  citations?: string;
}

/** `specs/screens/public-and-embed.md` public history — one older version's text. */
const versionsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: VersionParams; Querystring: VersionQuery }>(
    "/versions/:n",
    { config: PUBLIC_ROUTE },
    async (request) => {
      const { document } = loadPublicDocument(fastify, request);
      const n = Number(request.params.n);
      const version = resolveVersion(document, n);
      const rendered = fastify.rendering.render(
        version.commit,
        version.body,
        citationsFromQuery(request),
      );

      return {
        number: version.number,
        summary: version.summary,
        published_at: version.published_at,
        html: rendered.html,
      };
    },
  );
};

export default versionsRoute;
