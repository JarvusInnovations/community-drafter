import type { FastifyInstance } from "fastify";

import type { SubmissionEntry } from "../storage/read-model.ts";

/** `specs/data-model.md`: "At most one `draft` per person per document." */
export function findDraft(
  fastify: FastifyInstance,
  document: string,
  person: string,
): SubmissionEntry | undefined {
  return fastify.storage.readModel
    .listSubmissionsForDocument(document)
    .find((entry) => entry.record.person === person && entry.record.state === "draft");
}
