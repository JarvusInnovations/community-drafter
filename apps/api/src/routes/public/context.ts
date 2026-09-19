import type { FastifyInstance, FastifyRequest } from "fastify";

import { ApiError } from "../../errors.ts";
import { derivePhase, type Phase } from "../../phase/phase.ts";
import type { DocumentEntry } from "../../storage/read-model.ts";

/**
 * `specs/screens/public-and-embed.md`: "All 404 when `public_access = none`,
 * `state = draft`, or the slug is unknown, with the same body." One shared
 * instance, same reasoning as `errors.ts`'s `LINK_NOT_FOUND` — existence of
 * a document (draft or otherwise unlisted) is never disclosed to a public
 * caller who doesn't already have a working link.
 */
export const PUBLIC_NOT_FOUND = new ApiError(
  "not_found",
  "This document isn't available. If you believe this is a mistake, please contact the team that shared it with you.",
);

export interface PublicContext {
  document: DocumentEntry;
  phase: Phase;
}

/**
 * Common preamble for every `/d/:slug/*` handler: resolve the document the
 * route's `:slug` param names, and gate it exactly as
 * `specs/screens/public-and-embed.md` requires — unknown slug, `state =
 * draft`, or `public_access = none` (the gitsheets schema default) all
 * throw the one shared `PUBLIC_NOT_FOUND` instance.
 */
export function loadPublicDocument(
  fastify: FastifyInstance,
  request: FastifyRequest,
): PublicContext {
  const params = request.params as Record<string, string | undefined>;
  const slug = params.slug;
  if (!slug) throw PUBLIC_NOT_FOUND;

  const document = fastify.storage.readModel.getDocument(slug);
  if (!document) throw PUBLIC_NOT_FOUND;

  const access = document.record.public_access ?? "none";
  if (access === "none") throw PUBLIC_NOT_FOUND;
  if (document.record.state === "draft") throw PUBLIC_NOT_FOUND;

  const phase = derivePhase(document.record, new Date());
  return { document, phase };
}
