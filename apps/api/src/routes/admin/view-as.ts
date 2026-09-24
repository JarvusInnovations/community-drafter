import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { derivePhase } from "../../phase/phase.ts";
import { buildParticipantBundle } from "../participant/bundle.ts";
import { notFoundDocument } from "./context.ts";

interface Params {
  slug: string;
  person: string;
}

interface Query {
  v?: string;
}

/**
 * `specs/screens/admin-dashboard.md` § "View as": "renders the participant
 * document screen for that person read-only." Reuses the participant
 * bundle builder (`routes/participant/bundle.ts`) so the admin app's
 * view-as page is built from the exact same shape the participant SPA
 * renders — no separate admin-only document-view code path to drift.
 * Unlike the participant route, a still-`draft` document is not hidden:
 * an admin previewing a person's view before opening is exactly the kind
 * of "view as" this exists for.
 */
const viewAsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: Params; Querystring: Query }>(
    "/documents/:slug/participations/:person/bundle",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);

      const participation = fastify.storage.readModel.getParticipation(
        document.record.slug,
        request.params.person,
      );
      if (!participation) {
        throw new ApiError(
          "not_found",
          `No participation for '${request.params.person}' on '${document.record.slug}'.`,
        );
      }

      const phase = derivePhase(document.record, new Date());
      const requestedVersion = request.query.v !== undefined ? Number(request.query.v) : undefined;
      return buildParticipantBundle(fastify, document, participation, phase, requestedVersion);
    },
  );
};

export default viewAsRoute;
