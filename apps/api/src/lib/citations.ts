import { parseCitationsMode, type CitationsMode } from "@signatories/shared";
import type { FastifyRequest } from "fastify";

/**
 * `?citations=links|footnotes|hybrid` (`specs/behaviors/versioning.md` §
 * Citations). Anything unrecognized falls back rather than erroring: the
 * parameter changes presentation only, and a reader who mistypes a shared
 * URL should get the document, not an error page.
 *
 * The default differs by door, which is the whole point of the option. A
 * screen defaults to `links` — a reader who expressed no preference gets
 * links they can click. The deliverable defaults to `hybrid`, because the
 * PDF is read both on a screen and on paper and only hybrid serves both
 * (`specs/screens/deliverable.md` § Routes).
 */
export function citationsFromQuery(
  request: FastifyRequest,
  fallback: CitationsMode = "links",
): CitationsMode {
  const query = request.query as Record<string, string | undefined>;
  return parseCitationsMode(query.citations, fallback);
}
