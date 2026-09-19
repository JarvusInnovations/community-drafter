import type { FastifyInstance } from "fastify";

import type { ParticipationEntry } from "../storage/read-model.ts";

/** `specs/data-model.md` § `participations`: "Derived participant status for the dashboard". */
export type ParticipationStatus =
  | "unopened"
  | "opened"
  | "drafting"
  | "commented"
  | "signed"
  | "signed (conditional)"
  | "declined";

export function participationStatus(
  fastify: FastifyInstance,
  entry: ParticipationEntry,
): ParticipationStatus {
  const signature = entry.record.signature;
  if (signature && !signature.revoked) {
    return signature.conditional ? "signed (conditional)" : "signed";
  }

  const submissions = fastify.storage.readModel
    .listSubmissionsForDocument(entry.record.document)
    .filter((s) => s.record.person === entry.record.person);

  if (submissions.some((s) => s.record.state === "submitted" && s.record.judgement === "decline")) {
    return "declined";
  }
  if (submissions.some((s) => s.record.state === "submitted")) {
    return "commented";
  }
  if (submissions.some((s) => s.record.state === "draft")) {
    return "drafting";
  }
  if (entry.record.first_opened_at) return "opened";
  return "unopened";
}
