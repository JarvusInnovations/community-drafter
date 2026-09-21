import type { FastifyInstance } from "fastify";

import type { DocumentEntry, ParticipationEntry } from "../storage/read-model.ts";
import { firstName } from "../lib/mailer/shell.ts";
import { derivePhase } from "../phase/phase.ts";
import { clockLine } from "./format.ts";
import { personalLink, prefsLink, stopOptionalLink } from "./links.ts";
import { resolveSender } from "./sender.ts";
import { siteForDocument } from "../sites/site.ts";
import type { RecipientContext } from "./types.ts";

/**
 * One recipient's rendering context, assembled from the read model —
 * templates never see `fastify` or the read model directly (see
 * `types.ts`'s doc comment on why that's the leakage guard).
 */
export function buildRecipientContext(
  fastify: FastifyInstance,
  document: DocumentEntry,
  participation: ParticipationEntry,
): RecipientContext {
  const person = fastify.storage.readModel.getPerson(participation.record.person);
  const now = new Date();
  const phase = derivePhase(document.record, now);
  const timezone = fastify.config.INSTANCE_TIMEZONE || "UTC";
  // `specs/behaviors/sites.md`: every link and every address in this
  // message belongs to the **document's** site, whichever host the send was
  // triggered from.
  const site = siteForDocument(fastify, document.record);
  const sender = resolveSender(fastify, document.record, site);
  const personName = person?.name ?? participation.record.person;
  const senderName = sender.from.name;

  return {
    siteName: site.name,
    documentTitle: document.record.title,
    personName,
    firstName: firstName(personName),
    personEmail: person?.email ?? "",
    senderName,
    clockLine: clockLine(
      phase,
      document.record.comments_close_at,
      document.record.signing_closes_at,
      timezone,
      now,
    ),
    personalLink: personalLink(site.baseUrl, participation.record.token),
    prefsLink: prefsLink(site.baseUrl, participation.record.token),
    stopOptionalLink: stopOptionalLink(site.baseUrl, participation.record.token),
    fromName: sender.from.name,
    fromEmail: sender.from.email,
    replyTo: sender.replyTo,
    tag: sender.tag,
  };
}
