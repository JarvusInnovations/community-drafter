import type { FastifyInstance } from "fastify";

import type { DocumentEntry, ParticipationEntry } from "../storage/read-model.ts";
import { firstName } from "../lib/mailer/shell.ts";
import { derivePhase } from "../phase/phase.ts";
import { clockLine } from "./format.ts";
import { personalLink, prefsLink, stopOptionalLink } from "./links.ts";
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
  const instanceName = fastify.config.INSTANCE_NAME || "Community Drafter";
  const personName = person?.name ?? participation.record.person;
  const senderName = document.record.sender_name ?? instanceName;

  return {
    instanceName,
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
    personalLink: personalLink(fastify.config.PUBLIC_URL, participation.record.token),
    prefsLink: prefsLink(fastify.config.PUBLIC_URL, participation.record.token),
    stopOptionalLink: stopOptionalLink(fastify.config.PUBLIC_URL, participation.record.token),
    fromName: senderName,
    fromEmail: fastify.config.INSTANCE_FROM_EMAIL ?? "",
    replyTo: document.record.reply_to,
  };
}
