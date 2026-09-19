import type { FastifyInstance } from "fastify";

import type { DocumentEntry, ParticipationEntry } from "../storage/read-model.ts";
import { derivePhase } from "../phase/phase.ts";
import { formatDeadline } from "./format.ts";
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
  const phase = derivePhase(document.record, new Date());
  const timezone = fastify.config.INSTANCE_TIMEZONE || "UTC";

  const deadlineIso =
    phase === "commenting"
      ? document.record.comments_close_at
      : phase === "signing"
        ? document.record.signing_closes_at
        : undefined;

  return {
    instanceName: fastify.config.INSTANCE_NAME ?? "",
    documentTitle: document.record.title,
    personName: person?.name ?? participation.record.person,
    personEmail: person?.email ?? "",
    phaseLabel: phase,
    nextDeadline: formatDeadline(deadlineIso, timezone),
    personalLink: personalLink(fastify.config.PUBLIC_URL, participation.record.token),
    prefsLink: prefsLink(fastify.config.PUBLIC_URL, participation.record.token),
    stopOptionalLink: stopOptionalLink(fastify.config.PUBLIC_URL, participation.record.token),
    fromName: document.record.sender_name ?? fastify.config.INSTANCE_NAME ?? "",
    fromEmail: fastify.config.INSTANCE_FROM_EMAIL ?? "",
    replyTo: document.record.reply_to,
  };
}
