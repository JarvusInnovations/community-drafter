import type { FastifyPluginAsync } from "fastify";

import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { buildPrefsView } from "../../lib/prefs.ts";
import { buildSignatureView } from "../../lib/signature-view.ts";
import { computeSignatories } from "../../lib/signatories.ts";
import { buildSubmissionView } from "../../lib/submission-view.ts";
import { resolveVersion, versionListView } from "../../lib/versions.ts";
import { loadParticipantContext } from "./context.ts";

interface BundleQuery {
  v?: string;
}

const bundleRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: BundleQuery }>(
    "/bundle",
    { config: PARTICIPANT_ROUTE },
    async (request) => {
      const { document, participation, phase } = loadParticipantContext(fastify, request);
      const requestedVersion = request.query.v !== undefined ? Number(request.query.v) : undefined;
      const version = resolveVersion(document, requestedVersion);
      const latest = document.versions[document.versions.length - 1];
      const rendered = fastify.rendering.render(version.commit, version.body);

      const person = fastify.storage.readModel.getPerson(participation.record.person);
      const submissions = fastify.storage.readModel
        .listSubmissionsForDocument(document.record.slug)
        .filter((entry) => entry.record.person === participation.record.person);

      const position = fastify.storage.readModel.getPosition(
        document.record.slug,
        participation.record.person,
      );

      const signatories = computeSignatories(
        fastify.storage.readModel.listParticipationsForDocument(document.record.slug),
        document.record.show_signatories ?? "list",
      );

      // Side effect: record the open (batched, write-behind — `storage/tracker.ts`).
      fastify.storage.tracker.record(document.record.slug, participation.record.person);

      return {
        instance: { name: fastify.config.INSTANCE_NAME ?? "Community Drafter" },
        person: { id: person?.id ?? participation.record.person, name: person?.name ?? "" },
        document: {
          slug: document.record.slug,
          title: document.record.title,
          state: document.record.state,
          phase,
          opened_at: document.record.opened_at,
          comments_close_at: document.record.comments_close_at,
          signing_closes_at: document.record.signing_closes_at,
          capacities: document.record.capacities ?? ["personal", "official"],
          show_signatories: document.record.show_signatories ?? "list",
          reply_to: document.record.reply_to,
          sender_name: document.record.sender_name,
        },
        version: {
          number: version.number,
          summary: version.summary,
          published_at: version.published_at,
          final: version.final,
          html: rendered.html,
          is_current: version.number === latest?.number,
        },
        versions: versionListView(fastify, document),
        signature: buildSignatureView(participation),
        position: position
          ? {
              judgement: position.judgement,
              version: position.version,
              at: position.submittedAt,
              submission: position.submissionId,
            }
          : null,
        submissions: submissions.map((entry) => buildSubmissionView(fastify, entry)),
        signatories,
        prefill: {
          name: person?.name,
          org: person?.org,
          role: person?.role,
          descriptor: person?.descriptor,
          suggested_capacity: participation.record.suggested_capacity,
        },
        notify: buildPrefsView(participation),
      };
    },
  );
};

export default bundleRoute;
