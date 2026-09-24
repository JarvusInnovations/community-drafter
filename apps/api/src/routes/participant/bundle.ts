import { audienceOf } from "@signatories/shared";
import type { CitationsMode } from "@signatories/shared";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { citationsFromQuery } from "../../lib/citations.ts";
import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { buildPrefsView } from "../../lib/prefs.ts";
import { resolvePrefill } from "../../lib/prefill.ts";
import { buildSignatureView } from "../../lib/signature-view.ts";
import { computeSignatories } from "../../lib/signatories.ts";
import { buildSubmissionView } from "../../lib/submission-view.ts";
import { resolveVersion, versionListView } from "../../lib/versions.ts";
import { siteForDocument, siteIdentity } from "../../sites/site.ts";
import type { Phase } from "../../phase/phase.ts";
import type { DocumentEntry, ParticipationEntry } from "../../storage/read-model.ts";
import { loadParticipantContext } from "./context.ts";

interface BundleQuery {
  v?: string;
  citations?: string;
}

/**
 * The participant "bundle" shape, shared by `GET /i/:token/api/bundle` and
 * the admin "view-as" endpoint (`routes/admin/view-as.ts`) — same document,
 * same participation record, read by two different transports
 * (`specs/screens/admin-dashboard.md` § "View as": "renders the participant
 * document screen for that person read-only"). Pulled out here rather than
 * duplicated so the two routes can never drift on shape.
 */
export function buildParticipantBundle(
  fastify: FastifyInstance,
  document: DocumentEntry,
  participation: ParticipationEntry,
  phase: Phase,
  requestedVersion?: number,
  citations: CitationsMode = "links",
) {
  const version = resolveVersion(document, requestedVersion);
  const latest = document.versions[document.versions.length - 1];
  const rendered = fastify.rendering.render(version.commit, version.body, citations);

  // `specs/behaviors/sites.md` § People are per site: the person belongs to
  // the **document's** site, so that is what resolves them.
  const person = fastify.storage.readModel.getPersonOn(
    document.record.slug,
    participation.record.person,
  );
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

  return {
    // `specs/api/participant.md`: the **document's** site — name, and logo
    // and accent where set — replaces the earlier `instance: { name }`.
    site: siteIdentity(siteForDocument(fastify, document.record)),
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
      // `specs/behaviors/signatures.md` § Consent at signing: the sign card
      // says who will see the signer's name, which is the audience and who
      // the statement is addressed to (`specs/data-model.md` § Audience).
      // `public_access` is deliberately absent — who may read the draft is
      // not a fact a signer is asked to stand behind.
      audience: audienceOf(document.record),
      addressed_to: document.record.addressed_to ?? [],
      reply_to: document.record.reply_to,
      sender_name: document.record.sender_name,
      // `specs/behaviors/signatures.md` § Delivery: the card's delivered line.
      delivered_at: document.record.delivered_at,
      delivered_note: document.record.delivered_note,
    },
    version: {
      number: version.number,
      summary: version.summary,
      published_at: version.published_at,
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
    // `specs/screens/document.md` § Display Rules 3: every prefilled field
    // resolves for **this** document — the participation's own `prefill`
    // value, else the person's site-level default, else nothing.
    prefill: {
      ...resolvePrefill(person, participation.record),
      suggested_capacity: participation.record.suggested_capacity,
    },
    notify: buildPrefsView(participation),
  };
}

const bundleRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: BundleQuery }>(
    "/bundle",
    { config: PARTICIPANT_ROUTE },
    async (request) => {
      const { document, participation, phase } = loadParticipantContext(fastify, request);
      const requestedVersion = request.query.v !== undefined ? Number(request.query.v) : undefined;

      // Side effect: record the open (batched, write-behind — `storage/tracker.ts`).
      fastify.storage.tracker.record(document.record.slug, participation.record.person);

      return buildParticipantBundle(
        fastify,
        document,
        participation,
        phase,
        requestedVersion,
        citationsFromQuery(request),
      );
    },
  );
};

export default bundleRoute;
