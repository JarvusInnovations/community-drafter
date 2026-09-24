import type { Anchor, Disposition, Judgement } from "@signatories/shared";
import type { FastifyInstance } from "fastify";

import type { SubmissionEntry } from "../storage/read-model.ts";

/** `specs/api/participant.md`'s bundle `submissions[].comments[]` shape. */
export interface CommentView {
  id: string;
  anchor: Anchor | null;
  body: string;
  saved_at?: string;
  disposition: { outcome: Disposition; note?: string; version?: number } | null;
}

/** `specs/api/participant.md`'s bundle `submissions[]` shape (the person's own submissions). */
export interface SubmissionView {
  id: string;
  version: number;
  state: "draft" | "submitted";
  judgement: Judgement | null;
  reason?: string;
  started_at?: string;
  submitted_at?: string;
  comments: CommentView[];
}

/**
 * Builds the wire shape for one submission, shared by `GET .../bundle`,
 * `GET .../draft` and `POST .../submit`'s response. Each comment's
 * `saved_at` prefers `commentTiming`'s exact per-comment record
 * (`lib/comment-timing.ts`) and falls back to the submission-level timing
 * the read model already tracks — accurate for anything saved since this
 * process started, and a reasonable approximation (the same one this
 * codebase used before per-comment tracking existed) for anything older.
 */
export function buildSubmissionView(
  fastify: FastifyInstance,
  entry: SubmissionEntry,
): SubmissionView {
  const fallback =
    entry.timing.submittedAt ?? entry.timing.savedAt.at(-1) ?? entry.timing.startedAt;

  return {
    id: entry.record.id,
    version: entry.record.version,
    state: entry.record.state,
    judgement: entry.record.judgement ?? null,
    reason: entry.record.reason,
    started_at: entry.timing.startedAt,
    submitted_at: entry.timing.submittedAt,
    comments: (entry.record.comments ?? []).map((comment) => ({
      id: comment.id,
      anchor: comment.anchor ?? null,
      body: comment.body,
      saved_at:
        fastify.commentTiming.get(entry.record.document, entry.record.id, comment.id) ?? fallback,
      disposition: comment.disposition
        ? {
            outcome: comment.disposition,
            note: comment.disposition_note,
            version: comment.disposition_version,
          }
        : null,
    })),
  };
}
