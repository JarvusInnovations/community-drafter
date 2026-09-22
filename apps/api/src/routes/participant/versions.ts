import type { FastifyPluginAsync } from "fastify";

import { citationsFromQuery } from "../../lib/citations.ts";
import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { loadParticipantContext } from "./context.ts";

interface VersionParams {
  n: string;
}

interface VersionQuery {
  citations?: string;
}

const versionsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: VersionParams; Querystring: VersionQuery }>(
    "/versions/:n",
    { config: PARTICIPANT_ROUTE },
    async (request) => {
      const { document, participation } = loadParticipantContext(fastify, request);
      const n = Number(request.params.n);
      const version = resolveVersion(document, n);
      const rendered = fastify.rendering.render(
        version.commit,
        version.body,
        citationsFromQuery(request),
      );

      const myComments = fastify.storage.readModel
        .listSubmissionsForDocument(document.record.slug)
        .filter(
          (entry) =>
            entry.record.person === participation.record.person && entry.record.version === n,
        )
        .flatMap((entry) =>
          (entry.record.comments ?? []).map((comment) => ({
            id: comment.id,
            anchor: comment.anchor ?? null,
            body: comment.body,
            disposition: comment.disposition
              ? {
                  outcome: comment.disposition,
                  note: comment.disposition_note,
                  version: comment.disposition_version,
                }
              : null,
          })),
        );

      return {
        number: version.number,
        summary: version.summary,
        published_at: version.published_at,
        final: version.final,
        html: rendered.html,
        my_comments: myComments,
      };
    },
  );
};

export default versionsRoute;
