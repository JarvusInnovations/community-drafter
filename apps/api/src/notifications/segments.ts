import type { FastifyInstance } from "fastify";

import { isCurrentSigner, prefOn } from "../lib/notify.ts";
import { effectiveSignedVersion } from "../lib/signature-view.ts";
import type { ParticipationEntry } from "../storage/read-model.ts";

/**
 * `specs/behaviors/notifications.md` § Segments — every recipient rule in
 * the message matrix is written in these terms, derived at send time from
 * one participation on one document. A revoked link, or an invitation that
 * was never delivered, is in none of them.
 *
 * - `U` invited, never opened
 * - `O` opened, undecided: no current signature, not declined (may have commented)
 * - `S` a current, unconditional signature on the current version
 * - `S-behind` a current, unconditional signature on an older version
 * - `C` a current conditional signature, on any version
 * - `D` declined, or removed their name and has not signed again
 */
export type Segment = "U" | "O" | "S" | "S-behind" | "C" | "D";

export function segmentOf(
  fastify: FastifyInstance,
  entry: ParticipationEntry,
  currentVersion: number,
): Segment | undefined {
  if (entry.record.link_revoked) return undefined;
  const signature = entry.record.signature;
  if (signature && isCurrentSigner(entry)) {
    if (signature.conditional === true) return "C";
    const version = effectiveSignedVersion(entry);
    return version !== undefined && version < currentVersion ? "S-behind" : "S";
  }
  if (signature?.revoked === true) return "D";
  const position = fastify.storage.readModel.getPosition(
    entry.record.document,
    entry.record.person,
  );
  if (position?.judgement === "decline") return "D";
  if (entry.record.first_opened_at) return "O";
  if (entry.record.sent_at) return "U";
  return undefined;
}

function currentVersionOf(fastify: FastifyInstance, document: string): number {
  return fastify.storage.readModel.getDocument(document)?.versions.length ?? 0;
}

/** Every participation on `document` in one of `segments`. */
export function participationsIn(
  fastify: FastifyInstance,
  document: string,
  segments: readonly Segment[],
): ParticipationEntry[] {
  const current = currentVersionOf(fastify, document);
  const wanted = new Set(segments);
  return fastify.storage.readModel.listParticipationsForDocument(document).filter((entry) => {
    const segment = segmentOf(fastify, entry, current);
    return segment !== undefined && wanted.has(segment);
  });
}

/** How many participations fall in each segment — the dashboard's and the CLI's counts. */
export function segmentCounts(fastify: FastifyInstance, document: string): Record<Segment, number> {
  const current = currentVersionOf(fastify, document);
  const counts: Record<Segment, number> = { U: 0, O: 0, S: 0, "S-behind": 0, C: 0, D: 0 };
  for (const entry of fastify.storage.readModel.listParticipationsForDocument(document)) {
    const segment = segmentOf(fastify, entry, current);
    if (segment) counts[segment] += 1;
  }
  return counts;
}

/**
 * `schedule-changed-<ts>` reaches O — the people who have looked at the
 * document and not yet answered. Not preference-gated: an operator asked
 * for it with `--notify` (`specs/behaviors/notifications.md` § Messages).
 */
export function scheduleChangedRecipients(fastify: FastifyInstance, document: string): string[] {
  return participationsIn(fastify, document, ["O"]).map((entry) => entry.record.person);
}

/** `confirm-call-<ts>` reaches S-behind and C. */
export function confirmCallRecipients(
  fastify: FastifyInstance,
  document: string,
): Array<{ entry: ParticipationEntry; reason: "behind" | "conditional" }> {
  const current = currentVersionOf(fastify, document);
  return participationsIn(fastify, document, ["S-behind", "C"]).map((entry) => ({
    entry,
    reason: segmentOf(fastify, entry, current) === "C" ? "conditional" : "behind",
  }));
}

/** `delivered` reaches every current signer: S, S-behind and C. */
export function deliveredRecipients(fastify: FastifyInstance, document: string): string[] {
  return participationsIn(fastify, document, ["S", "S-behind", "C"]).map(
    (entry) => entry.record.person,
  );
}

/**
 * `disposition-v<n>` reaches the authors this publish answered, in O, S,
 * S-behind, C or D, with `my_comments_addressed` on. U is impossible for an
 * author (commenting needs an opened link); the segment test is kept anyway
 * so a revoked link is never mailed.
 */
export function dispositionRecipients(
  fastify: FastifyInstance,
  document: string,
  authors: readonly string[],
): string[] {
  const wanted = new Set(authors);
  return participationsIn(fastify, document, ["O", "S", "S-behind", "C", "D"])
    .filter((entry) => wanted.has(entry.record.person))
    .filter((entry) => prefOn(entry, "my_comments_addressed"))
    .map((entry) => entry.record.person);
}
