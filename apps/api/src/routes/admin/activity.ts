import type { FastifyPluginAsync } from "fastify";

import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface ActivityQuery {
  limit?: string;
  person?: string;
}

/** `specs/api/admin.md` § Activity: "the last 50 commits ... parsed from trailers." */
const activityRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: DocumentParams; Querystring: ActivityQuery }>(
    "/documents/:slug/activity",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const limit = request.query.limit !== undefined ? Number(request.query.limit) : 50;

      let entries = document.activity;
      if (request.query.person) {
        entries = entries.filter((entry) => entry.trailers.Person === request.query.person);
      }

      // `specs/behaviors/operators.md` § Superadmins: an actor absent from
      // this document's operator list is otherwise indistinguishable from
      // an unauthorized write, so a superadmin acting with standing is
      // labeled. Derived at read time from the two records — the `Actor`
      // trailer itself stays the plain email.
      const documentOperators = new Set(
        (document.record.operators ?? []).map((email) => email.toLowerCase()),
      );
      const isOutsideSuperadmin = (actor: string): boolean => {
        if (!actor || documentOperators.has(actor.toLowerCase())) return false;
        return fastify.storage.readModel.getOperatorByEmail(actor)?.superadmin === true;
      };

      return entries.slice(0, limit).map((entry) => ({
        commit: entry.commit,
        date: entry.at,
        subject: entry.subject,
        action: entry.action,
        person: entry.trailers.Person,
        version: entry.trailers.Version ? Number(entry.trailers.Version) : undefined,
        judgement: entry.trailers.Judgement,
        reason: entry.trailers.Reason,
        actor: entry.actor,
        actor_superadmin: isOutsideSuperadmin(entry.actor) || undefined,
      }));
    },
  );
};

export default activityRoute;
