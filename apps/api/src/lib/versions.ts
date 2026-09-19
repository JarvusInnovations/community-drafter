import type { FastifyInstance } from "fastify";

import { ApiError } from "../errors.ts";
import type { DocumentEntry, DocumentVersion } from "../storage/read-model.ts";

/**
 * `specs/api/conventions.md` § Versions in the API: "`?v=<n>` where a
 * version is optional; default is current." Current = the latest published
 * version. Throws `not_found` for a document with no published version yet
 * (shouldn't happen once `open`, since opening requires ≥1 version) or a
 * `v` naming a version that doesn't exist.
 */
export function resolveVersion(documentEntry: DocumentEntry, requested?: number): DocumentVersion {
  const versions = documentEntry.versions;
  if (versions.length === 0) {
    throw new ApiError("not_found", "This document has no published version yet.");
  }
  const latest = versions[versions.length - 1] as DocumentVersion;
  const target = requested ?? latest.number;
  const version = versions.find((candidate) => candidate.number === target);
  if (!version) {
    throw new ApiError("not_found", `Version ${target} does not exist.`);
  }
  return version;
}

/** `specs/behaviors/versioning.md` § History: "how many comments it answered (count of dispositions)". */
export function dispositionsCount(
  fastify: FastifyInstance,
  document: string,
  versionNumber: number,
): number {
  let count = 0;
  for (const entry of fastify.storage.readModel.listSubmissionsForDocument(document)) {
    for (const comment of entry.record.comments ?? []) {
      if (comment.disposition_version === versionNumber) count += 1;
    }
  }
  return count;
}

export interface VersionListItem {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  dispositions: number;
}

export function versionListView(
  fastify: FastifyInstance,
  documentEntry: DocumentEntry,
): VersionListItem[] {
  return documentEntry.versions.map((version) => ({
    number: version.number,
    summary: version.summary,
    published_at: version.published_at,
    final: version.final,
    dispositions: dispositionsCount(fastify, documentEntry.record.slug, version.number),
  }));
}
