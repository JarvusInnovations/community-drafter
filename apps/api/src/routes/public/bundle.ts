import type { FastifyPluginAsync } from "fastify";

import { PUBLIC_ROUTE } from "../../gateway/gateway.ts";
import { computeSignatories } from "../../lib/signatories.ts";
import { resolveVersion, versionListView } from "../../lib/versions.ts";
import { siteForDocument, siteIdentity } from "../../sites/site.ts";
import { loadPublicDocument } from "./context.ts";

interface BundleParams {
  slug: string;
}

interface BundleQuery {
  v?: string;
}

/**
 * `specs/screens/public-and-embed.md` § Data Requirements: "Document
 * (title, phase, deadlines, `show_signatories`, `reply_to`), current
 * version, signatory counts and list ..., version list." Deliberately the
 * same shape family as `routes/participant/bundle.ts` minus every
 * person-specific field (no `person`, `signature`, `position`,
 * `submissions`, `prefill`, `notify` — nothing a public caller could use to
 * infer who signed via a token or address).
 */
const bundleRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: BundleParams; Querystring: BundleQuery }>(
    "/bundle",
    { config: PUBLIC_ROUTE },
    async (request) => {
      const { document, phase } = loadPublicDocument(fastify, request);
      const requestedVersion = request.query.v !== undefined ? Number(request.query.v) : undefined;
      const version = resolveVersion(document, requestedVersion);
      const latest = document.versions[document.versions.length - 1];
      const rendered = fastify.rendering.render(version.commit, version.body);

      const signatories = computeSignatories(
        fastify.storage.readModel.listParticipationsForDocument(document.record.slug),
        document.record.show_signatories ?? "list",
      );

      return {
        // `specs/screens/public-and-embed.md` § Site identity: the top bar
        // names the document's site, and the accent token follows its own.
        site: siteIdentity(siteForDocument(fastify, document.record)),
        document: {
          slug: document.record.slug,
          title: document.record.title,
          state: document.record.state,
          phase,
          opened_at: document.record.opened_at,
          comments_close_at: document.record.comments_close_at,
          signing_closes_at: document.record.signing_closes_at,
          show_signatories: document.record.show_signatories ?? "list",
          // `specs/screens/public-and-embed.md` § Data Requirements: here
          // for one reason — it decides whether the footer offers the
          // statement download (`specs/screens/deliverable.md`). A document
          // stored without it reads `closed` (`specs/data-model.md` §
          // Audience). `public_access` is still not in this payload.
          audience: document.record.audience ?? "closed",
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
        signatories,
      };
    },
  );
};

export default bundleRoute;
