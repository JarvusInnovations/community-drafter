import type { FastifyInstance } from "fastify";

import type { DocumentEntry } from "../storage/read-model.ts";

/**
 * The one gate every public surface asks: may an anonymous caller see this
 * document at all? `specs/screens/public-and-embed.md`: "All 404 when
 * `public_access = none`, `state = draft`, or the slug is unknown, with the
 * same body." Returns `null` for all three without distinguishing them —
 * callers that answer a request throw the shared `PUBLIC_NOT_FOUND`
 * (`routes/public/context.ts`), and the share-preview resolver
 * (`lib/share-preview.ts`) falls back to the generic instance tags, so both
 * the body and the metadata treat a private document and a document that
 * never existed identically.
 */
export function findPublicDocument(
  fastify: FastifyInstance,
  slug: string | undefined,
): DocumentEntry | null {
  if (!slug) return null;

  const document = fastify.storage.readModel.getDocument(slug);
  if (!document) return null;

  const access = document.record.public_access ?? "none";
  if (access === "none") return null;
  if (document.record.state === "draft") return null;

  return document;
}
