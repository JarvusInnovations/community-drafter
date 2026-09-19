import type { FastifyPluginAsync } from "fastify";

import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { mintSubmissionId } from "../../lib/ids.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { assertPhase } from "../../phase/phase.ts";
import { loadParticipantContext } from "./context.ts";

interface DeclineBody {
  reason?: string;
}

/**
 * `specs/api/participant.md` § `POST decline`: "Records decline; revokes a
 * signature if one exists ... Response: `{ declined_at }`."
 * `specs/behaviors/review-and-judgement.md`: "`decline` may be submitted
 * with no comments at all ... Decline revokes any current signature after
 * confirmation and stops reminders. A later sign replaces the `decline`
 * position." One `Action: submit` commit creates the empty submitted
 * submission and (when a signature exists) revokes it together.
 */
const declineRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: DeclineBody }>(
    "/decline",
    { config: PARTICIPANT_ROUTE },
    async (request) => {
      const { document, participation } = loadParticipantContext(fastify, request);
      assertPhase(document.record, new Date(), "decline");

      const person = participation.record.person;
      const slug = document.record.slug;
      const version = resolveVersion(document).number;
      const id = mintSubmissionId(fastify, slug, person);
      const reason = request.body?.reason;
      const existingSignature = participation.record.signature;
      const shouldRevokeSignature = existingSignature && existingSignature.revoked !== true;

      await fastify.storage.commit(
        "submit",
        {
          actor: { kind: "participant" },
          subject: `submit: ${person} on ${slug} v${version} (decline)`,
          document: slug,
          person,
          submission: id,
          version,
          judgement: "decline",
          reason,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.submissions.upsert({
            document: slug,
            id,
            person,
            version,
            state: "submitted",
            judgement: "decline",
            reason,
            comments: [],
          });
          // `specs/behaviors/notifications.md` § Defaults: reminders default
          // "on ... until the person signs, comments, or declines; then
          // automatically off." Folded into the same commit either way.
          const notify = { ...participation.record.notify, reminders: false };
          if (shouldRevokeSignature) {
            await tx.participations.patch(
              { document: slug, person },
              { signature: { ...existingSignature, revoked: true }, notify },
            );
          } else {
            await tx.participations.patch({ document: slug, person }, { notify });
          }
        },
      );

      fastify.events.publish({ type: "decline", document: slug, person, commit: "", reason });

      const submission = fastify.storage.readModel.getSubmission(slug, id);
      return { declined_at: submission?.timing.submittedAt ?? new Date().toISOString() };
    },
  );
};

export default declineRoute;
