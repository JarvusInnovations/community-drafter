import type { FastifyPluginAsync } from "fastify";

import { PUBLIC_ROUTE } from "../../gateway/gateway.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { loadPublicDocument } from "./context.ts";

interface VersionParams {
  slug: string;
  n: string;
}

/** `specs/screens/public-and-embed.md` public history — one older version's text. */
const versionsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: VersionParams }>(
    "/versions/:n",
    { config: PUBLIC_ROUTE },
    async (request) => {
      const { document } = loadPublicDocument(fastify, request);
      const n = Number(request.params.n);
      const version = resolveVersion(document, n);
      const rendered = fastify.rendering.render(version.commit, version.body);

      return {
        number: version.number,
        summary: version.summary,
        published_at: version.published_at,
        final: version.final,
        html: rendered.html,
      };
    },
  );
};

export default versionsRoute;
