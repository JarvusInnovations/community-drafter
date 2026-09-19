import type { FastifyPluginAsync } from "fastify";

import { dispatchPublishNotifications } from "../../lib/notify.ts";
import { ADMIN_ROUTE } from "../../gateway/gateway.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface RetryBody {
  event?: string;
  person?: string;
}

/**
 * `specs/api/admin.md` § Notifications. `pending`/`failed` come "from the
 * dispatcher's memory" per spec — this plan's dispatcher is a synchronous
 * stub with no queue of its own (see `lib/notify.ts`), so both are always
 * `0` here; a real async dispatcher with retries is the `notifications`
 * plan's addition. `sent` is real: it's a live tally of every
 * `participations.notified` key on the document.
 */
const adminNotificationsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: DocumentParams }>(
    "/documents/:slug/notifications",
    { config: ADMIN_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);

      const sent: Record<string, number> = {};
      for (const entry of fastify.storage.readModel.listParticipationsForDocument(
        document.record.slug,
      )) {
        for (const key of Object.keys(entry.record.notified ?? {})) {
          sent[key] = (sent[key] ?? 0) + 1;
        }
      }

      return { sent, pending: 0, failed: 0 };
    },
  );

  fastify.post<{ Params: DocumentParams; Body: RetryBody }>(
    "/documents/:slug/notifications/retry",
    { config: ADMIN_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const latest = document.versions[document.versions.length - 1];
      if (!latest) return { retried: 0 };

      const notified = await dispatchPublishNotifications({
        fastify,
        document: document.record.slug,
        version: latest.number,
        final: latest.final,
        dispositionedPersons: [],
        actor: adminActor(request),
        requestId: request.requestId,
      });

      return { retried: notified.every_revision + notified.dispositions + notified.signers };
    },
  );
};

export default adminNotificationsRoute;
