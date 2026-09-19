import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { ADMIN_ROUTE } from "../../gateway/gateway.ts";
import { buildSignatureView } from "../../lib/signature-view.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface PersonParams extends DocumentParams {
  person: string;
}

interface ListSignaturesQuery {
  include_revoked?: string;
}

interface RevokeBody {
  reason: string;
}

const adminSignaturesRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: DocumentParams; Querystring: ListSignaturesQuery }>(
    "/documents/:slug/signatures",
    { config: ADMIN_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const includeRevoked = request.query.include_revoked === "true";

      return fastify.storage.readModel
        .listParticipationsForDocument(document.record.slug)
        .filter((entry) => entry.record.signature !== undefined)
        .filter((entry) => includeRevoked || entry.record.signature?.revoked !== true)
        .map((entry) => {
          const person = fastify.storage.readModel.getPerson(entry.record.person);
          return {
            person: entry.record.person,
            name: person?.name ?? "",
            signature: buildSignatureView(entry),
          };
        });
    },
  );

  fastify.post<{ Params: PersonParams; Body: RevokeBody }>(
    "/documents/:slug/signatures/:person/revoke",
    { config: ADMIN_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const person = request.params.person;
      const { reason } = request.body;

      const participation = fastify.storage.readModel.getParticipation(slug, person);
      const signature = participation?.record.signature;
      if (!participation || !signature || signature.revoked) {
        throw new ApiError("not_found", `'${person}' has not signed '${slug}'.`);
      }

      const result = await fastify.storage.commit(
        "admin-revoke",
        {
          actor: adminActor(request),
          subject: `revoke: ${person} on ${slug} (admin)`,
          document: slug,
          person,
          reason,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.participations.patch(
            { document: slug, person },
            { signature: { ...signature, revoked: true } },
          );
        },
      );

      await fastify.events.publish({
        type: "revoke",
        document: slug,
        person,
        commit: result.commitHash ?? "",
        reason,
      });

      const updated = fastify.storage.readModel.getParticipation(slug, person);
      return { ...buildSignatureView(updated!), commit: result.commitHash };
    },
  );
};

export default adminSignaturesRoute;
