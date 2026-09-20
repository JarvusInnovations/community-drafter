import type { FastifyPluginAsync } from "fastify";

import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface RetryBody {
  event?: string;
  person?: string;
}

/**
 * `specs/api/admin.md` § Notifications. `sent` is a live tally of every
 * `participations.notified` key on the document (works for every event
 * kind, including the ones a route writes itself — `lib/notify.ts`'s
 * publish marks and `invitations.ts`'s reminder count). Every key there is
 * a message the mailer accepted (`specs/behaviors/notifications.md` §
 * Sending), so the tally counts deliveries. `pending` stays `0` — sends
 * aren't queued, the
 * dispatcher renders and delivers them inline (with its own retry/backoff)
 * as soon as the triggering commit lands, so nothing is ever "waiting to
 * start"; `failed` is `notifications.failedCount`, the dispatcher's
 * in-memory bucket of sends that exhausted their retries.
 */
const adminNotificationsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: DocumentParams }>(
    "/documents/:slug/notifications",
    { config: DOCUMENT_SCOPED_ROUTE },
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

      return {
        sent,
        pending: 0,
        failed: fastify.notifications.failedCount(document.record.slug),
        failures: fastify.notifications.failureList(document.record.slug),
      };
    },
  );

  fastify.post<{ Params: DocumentParams; Body: RetryBody }>(
    "/documents/:slug/notifications/retry",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);

      const { event, person } = request.body ?? {};
      const result = await fastify.notifications.retry(
        document.record.slug,
        { event, person },
        adminActor(request),
        request.requestId,
      );

      return result;
    },
  );
};

export default adminNotificationsRoute;
