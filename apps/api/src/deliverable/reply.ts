import type { FastifyReply, FastifyRequest } from "fastify";

import { parsePaper, type Paper } from "./view.ts";
import type { DeliverablePdf } from "./plugin.ts";

/** `?paper=letter|a4` (`specs/screens/deliverable.md` § Design); letter is the default. */
export function paperFromQuery(request: FastifyRequest): Paper {
  const query = request.query as Record<string, string | undefined>;
  return parsePaper(query.paper);
}

/**
 * `specs/screens/deliverable.md` § Routes: "`application/pdf` with a
 * `Content-Disposition: attachment` filename of `<slug>-v<n>.pdf`, or
 * `<slug>-v<n>-draft.pdf` while the deliverable is a draft." Attachment
 * rather than inline on every door: the point of the file is that someone
 * keeps it, and a filename that says `-draft` only helps if it survives the
 * download.
 */
export function sendPdf(reply: FastifyReply, pdf: DeliverablePdf): FastifyReply {
  return reply
    .header("content-type", "application/pdf")
    .header("content-disposition", `attachment; filename="${pdf.view.filename}"`)
    .header("cache-control", "no-store")
    .send(Buffer.from(pdf.bytes));
}
