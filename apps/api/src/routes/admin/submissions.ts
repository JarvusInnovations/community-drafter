import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { computeSignatories } from "../../lib/signatories.ts";
import { resolveVersion } from "../../lib/versions.ts";
import type { SubmissionEntry } from "../../storage/read-model.ts";
import { notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface ListSubmissionsQuery {
  state?: "submitted" | "draft" | "all";
  disposition?: "pending" | "answered" | "unanswered";
  version?: string;
  person?: string;
}

interface FeedbackExportQuery {
  format?: "json" | "md";
}

function hasPendingComment(entry: SubmissionEntry): boolean {
  return (entry.record.comments ?? []).some((comment) => !comment.disposition);
}

function isFullyDispositioned(entry: SubmissionEntry): boolean {
  const comments = entry.record.comments ?? [];
  return comments.length > 0 && comments.every((comment) => Boolean(comment.disposition));
}

function submissionView(fastify: FastifyInstance, entry: SubmissionEntry) {
  const person = fastify.storage.readModel.getPerson(entry.record.person);
  return {
    id: entry.record.id,
    author: person?.name ?? entry.record.person,
    person: entry.record.person,
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

const adminSubmissionsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: DocumentParams; Querystring: ListSubmissionsQuery }>(
    "/documents/:slug/submissions",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const { state = "submitted", disposition, version, person } = request.query;

      let entries = fastify.storage.readModel.listSubmissionsForDocument(document.record.slug);
      if (state !== "all") entries = entries.filter((entry) => entry.record.state === state);
      if (version !== undefined) {
        const n = Number(version);
        entries = entries.filter((entry) => entry.record.version === n);
      }
      if (person) entries = entries.filter((entry) => entry.record.person === person);
      if (disposition === "pending" || disposition === "unanswered") {
        entries = entries.filter(hasPendingComment);
      } else if (disposition === "answered") {
        entries = entries.filter(isFullyDispositioned);
      }

      return entries.map((entry) => submissionView(fastify, entry));
    },
  );

  fastify.get<{ Params: DocumentParams; Querystring: FeedbackExportQuery }>(
    "/documents/:slug/feedback-export",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request, reply) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const version = resolveVersion(document);

      const allSubmissions = fastify.storage.readModel.listSubmissionsForDocument(
        document.record.slug,
      );
      const withPending = allSubmissions.filter(hasPendingComment);
      const submitted = withPending.filter((entry) => entry.record.state === "submitted");
      const drafts = withPending.filter((entry) => entry.record.state === "draft");

      const judgementTally: Record<number, Record<string, number>> = {};
      for (const entry of allSubmissions) {
        if (entry.record.state !== "submitted" || !entry.record.judgement) continue;
        const tally = (judgementTally[entry.record.version] ??= {});
        tally[entry.record.judgement] = (tally[entry.record.judgement] ?? 0) + 1;
      }

      const signatories = computeSignatories(
        fastify.storage.readModel.listParticipationsForDocument(document.record.slug),
        "list",
      );

      const payload = {
        document: document.record.slug,
        version: { number: version.number, summary: version.summary, body: version.body },
        submissions: {
          submitted: submitted.map((entry) => submissionView(fastify, entry)),
          draft: drafts.map((entry) => submissionView(fastify, entry)),
        },
        judgement_tally: judgementTally,
        signatory_count: signatories,
      };

      if (request.query.format === "md") {
        const lines: string[] = [];
        lines.push(`# Feedback export: ${document.record.title}`);
        lines.push("");
        lines.push(`Version ${version.number} — ${version.summary}`);
        lines.push("");
        // `specs/behaviors/review-and-judgement.md`: "Every section of the
        // export states its own emptiness — a heading with nothing under
        // it reads as a truncated file, not as 'none yet'." (#60)
        lines.push("## Submitted");
        lines.push("");
        if (payload.submissions.submitted.length === 0) {
          lines.push("_No submissions yet._");
          lines.push("");
        }
        for (const entry of payload.submissions.submitted) {
          lines.push(`### ${entry.author} — v${entry.version} (${entry.judgement ?? "comment"})`);
          for (const comment of entry.comments) {
            lines.push(`- ${comment.body}`);
          }
          lines.push("");
        }
        lines.push("## Draft (unsubmitted)");
        lines.push("");
        if (payload.submissions.draft.length === 0) {
          lines.push("_No unsubmitted drafts._");
          lines.push("");
        }
        for (const entry of payload.submissions.draft) {
          lines.push(`### ${entry.author} — v${entry.version} (unsubmitted)`);
          for (const comment of entry.comments) {
            lines.push(`- ${comment.body}`);
          }
          lines.push("");
        }
        reply.header("content-type", "text/markdown; charset=utf-8");
        return lines.join("\n");
      }

      return payload;
    },
  );
};

export default adminSubmissionsRoute;
