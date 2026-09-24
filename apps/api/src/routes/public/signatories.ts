import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { PUBLIC_ROUTE } from "../../gateway/gateway.ts";
import { computeSignatories } from "../../lib/signatories.ts";
import { loadPublicDocument } from "./context.ts";

interface SignatoriesParams {
  slug: string;
}

/**
 * `specs/screens/public-and-embed.md`: "`GET /d/<slug>/signatories.json` |
 * counts and the listed signatories | CORS `*`". This is the one route the
 * `widget.js` script (a foreign-origin `<script>` embed) fetches, so it
 * carries an open CORS header and a short cache lifetime (60 s — "CORS +
 * caching" risk in `plans/public-and-embed.md`: counts move within minutes
 * without hammering the instance on every host-page load).
 *
 * `show_signatories = none` means "shows nothing ... to the public"
 * (`specs/behaviors/signatures.md` § Display) — honored here as a 404
 * rather than a `200` with zeroed counts, which would misrepresent a
 * document that in fact has signatories. `widget.js` treats any non-2xx the
 * same way (renders nothing), so this degrades exactly like a missing
 * document would.
 */
const signatoriesRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: SignatoriesParams }>(
    "/signatories.json",
    { config: PUBLIC_ROUTE },
    async (request, reply) => {
      const { document } = loadPublicDocument(fastify, request);

      const signatories = computeSignatories(
        fastify.storage.readModel.listParticipationsForDocument(document.record.slug),
        document.record.show_signatories ?? "list",
      );
      if (!signatories) {
        throw new ApiError("not_found", "Signatories are not shown for this document.");
      }

      reply.header("access-control-allow-origin", "*");
      reply.header("cache-control", "public, max-age=60");
      return signatories;
    },
  );
};

export default signatoriesRoute;
