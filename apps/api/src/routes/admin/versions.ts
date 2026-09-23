import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { personDispositionOutcomes } from "../../lib/notify.ts";
import { resolveVersion, versionListView } from "../../lib/versions.ts";
import { dispositionRecipients } from "../../notifications/segments.ts";
import { dispositionTemplate } from "../../notifications/templates.ts";
import { assertPhase } from "../../phase/phase.ts";
import type { DocumentEntry } from "../../storage/read-model.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface VersionParams extends DocumentParams {
  n: string;
}

interface DispositionInput {
  submission: string;
  comment: string;
  outcome: "accepted" | "partial" | "declined" | "noted";
  note?: string;
}

interface PublishBody {
  body: string;
  summary: string;
  notes?: string;
  /**
   * `specs/api/admin.md` § Versions: publishing mails nobody unless this is
   * true, and then only the authors this publish answered
   * (`specs/behaviors/notifications.md` → `disposition-v<n>`).
   */
  notify_commenters?: boolean;
  dispositions?: DispositionInput[];
}

interface CompareQuery {
  from?: string;
  to?: string;
}

function dispositionsForVersion(fastify: FastifyInstance, slug: string, versionNumber: number) {
  const out: Array<{ submission: string; comment: string; outcome: string; note?: string }> = [];
  for (const entry of fastify.storage.readModel.listSubmissionsForDocument(slug)) {
    for (const comment of entry.record.comments ?? []) {
      if (comment.disposition_version === versionNumber && comment.disposition) {
        out.push({
          submission: entry.record.id,
          comment: comment.id,
          outcome: comment.disposition,
          note: comment.disposition_note,
        });
      }
    }
  }
  return out;
}

function adminVersionView(fastify: FastifyInstance, entry: DocumentEntry, number: number) {
  const version = resolveVersion(entry, number);
  return {
    number: version.number,
    commit: version.commit,
    summary: version.summary,
    published_at: version.published_at,
    published_by: version.published_by,
    notes: version.notes,
    body: version.body,
    dispositions: dispositionsForVersion(fastify, entry.record.slug, version.number),
  };
}

function requireDocument(fastify: FastifyInstance, slug: string): DocumentEntry {
  const entry = fastify.storage.readModel.getDocument(slug);
  if (!entry) throw notFoundDocument(slug);
  return entry;
}

const adminVersionsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: DocumentParams }>(
    "/documents/:slug/versions",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = requireDocument(fastify, request.params.slug);
      return versionListView(fastify, entry);
    },
  );

  fastify.get<{ Params: VersionParams }>(
    "/documents/:slug/versions/:n",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = requireDocument(fastify, request.params.slug);
      return adminVersionView(fastify, entry, Number(request.params.n));
    },
  );

  fastify.post<{ Params: DocumentParams; Body: PublishBody }>(
    "/documents/:slug/versions",
    {
      config: DOCUMENT_SCOPED_ROUTE,
      schema: {
        body: {
          type: "object",
          required: ["body", "summary"],
          properties: {
            body: { type: "string" },
            summary: { type: "string", minLength: 1, maxLength: 200 },
            notes: { type: "string" },
            notify_commenters: { type: "boolean" },
            // A retired flag from earlier CLIs: accepted and ignored
            // (`specs/api/admin.md` § Versions — no version is "final").
            final: { type: "boolean" },
            dispositions: {
              type: "array",
              items: {
                type: "object",
                required: ["submission", "comment", "outcome"],
                properties: {
                  submission: { type: "string" },
                  comment: { type: "string" },
                  outcome: { type: "string", enum: ["accepted", "partial", "declined", "noted"] },
                  note: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const entry = requireDocument(fastify, request.params.slug);
      const slug = entry.record.slug;
      const now = new Date();
      const phaseBeforePublish = assertPhase(entry.record, now, "admin_publish");
      const { body, summary, notes, notify_commenters, dispositions = [] } = request.body;

      if (body === entry.record.body) {
        throw new ApiError("no_change", "The new text is identical to the current version.");
      }

      const dispositionedPersons = new Set<string>();
      const commentUpdates = new Map<string, Map<string, DispositionInput>>();
      for (const disposition of dispositions) {
        const submission = fastify.storage.readModel.getSubmission(slug, disposition.submission);
        if (!submission) {
          throw new ApiError(
            "validation_failed",
            `Unknown submission '${disposition.submission}'.`,
            { field: "dispositions" },
          );
        }
        const comment = (submission.record.comments ?? []).find(
          (c) => c.id === disposition.comment,
        );
        if (!comment) {
          throw new ApiError(
            "validation_failed",
            `Unknown comment '${disposition.comment}' on submission '${disposition.submission}'.`,
            { field: "dispositions" },
          );
        }
        if (disposition.outcome === "declined" && !disposition.note) {
          throw new ApiError("validation_failed", "A declined disposition requires a note.", {
            field: "note",
          });
        }
        dispositionedPersons.add(submission.record.person);
        const bySubmission = commentUpdates.get(disposition.submission) ?? new Map();
        bySubmission.set(disposition.comment, disposition);
        commentUpdates.set(disposition.submission, bySubmission);
      }

      const newVersionNumber = entry.versions.length + 1;
      const revocationWindowHours = entry.record.revocation_window_hours ?? 72;
      const documentPatch: Record<string, unknown> = { body };
      let extendedSigningClosesAt: string | undefined;
      if (phaseBeforePublish === "signing") {
        const minSigningClosesAt = new Date(now.getTime() + revocationWindowHours * 60 * 60 * 1000);
        const currentSigningClosesAt = entry.record.signing_closes_at
          ? new Date(entry.record.signing_closes_at)
          : minSigningClosesAt;
        extendedSigningClosesAt =
          currentSigningClosesAt > minSigningClosesAt
            ? currentSigningClosesAt.toISOString()
            : minSigningClosesAt.toISOString();
        documentPatch.signing_closes_at = extendedSigningClosesAt;
      }

      const disposedRefs: string[] = [];
      for (const [submissionId, comments] of commentUpdates) {
        for (const [commentId] of comments) disposedRefs.push(`${submissionId}:${commentId}`);
      }

      const result = await fastify.storage.commit(
        "publish",
        {
          actor: adminActor(request),
          subject: `publish: ${slug} v${newVersionNumber}`,
          document: slug,
          version: newVersionNumber,
          summary,
          notes,
          disposed: disposedRefs.length > 0 ? disposedRefs.join(",") : undefined,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch({ slug }, documentPatch);
          for (const [submissionId, comments] of commentUpdates) {
            const submission = await tx.submissions.queryFirst({
              document: slug,
              id: submissionId,
            });
            if (!submission) continue;
            const nextComments = (submission.comments ?? []).map((comment) => {
              const disposition = comments.get(comment.id);
              if (!disposition) return comment;
              return {
                ...comment,
                disposition: disposition.outcome,
                disposition_note: disposition.note,
                disposition_version: newVersionNumber,
              };
            });
            await tx.submissions.patch(
              { document: slug, id: submissionId },
              { comments: nextComments },
            );
          }
        },
      );

      // `specs/principles.md` § Operators speak; state changes don't: a
      // publish mails nobody by itself. The answered commenters are counted
      // either way, so the operator reads whom they did — or did not — tell.
      const actor = adminActor(request);
      const commenterRecipients = dispositionRecipients(fastify, slug, [...dispositionedPersons]);
      const commenters: {
        requested: boolean;
        would_notify: number;
        sent?: number;
        failed?: number;
        failures?: Array<{ person: string; error: string }>;
      } = { requested: notify_commenters === true, would_notify: commenterRecipients.length };
      if (notify_commenters === true && commenterRecipients.length > 0) {
        const fromVersion = Math.max(1, newVersionNumber - 1);
        const delivery = await fastify.notifications.deliver({
          document: slug,
          eventKey: `disposition-v${newVersionNumber}`,
          actor,
          requestId: request.requestId,
          targets: commenterRecipients.map((person) => ({
            person,
            markNotified: true,
            render: (ctx) =>
              dispositionTemplate(ctx, {
                version: newVersionNumber,
                outcomes: personDispositionOutcomes(fastify, slug, person, newVersionNumber),
                compareLink: `${ctx.personalLink}/history/compare?from=${fromVersion}&to=${newVersionNumber}`,
              }),
          })),
        });
        commenters.sent = delivery.sent;
        commenters.failed = delivery.failed;
        commenters.failures = delivery.failures;
      } else if (notify_commenters === true) {
        commenters.sent = 0;
        commenters.failed = 0;
        commenters.failures = [];
      }

      await fastify.events.publish({
        type: "publish",
        document: slug,
        version: newVersionNumber,
        commit: result.commitHash ?? "",
      });

      return {
        number: newVersionNumber,
        summary,
        commit: result.commitHash,
        signing_closes_at: extendedSigningClosesAt,
        notified: { commenters },
      };
    },
  );

  fastify.get<{ Params: DocumentParams; Querystring: CompareQuery }>(
    "/documents/:slug/compare",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = requireDocument(fastify, request.params.slug);
      const latest = resolveVersion(entry);

      const toNumber = request.query.to !== undefined ? Number(request.query.to) : latest.number;
      const defaultFrom = Math.max(1, toNumber - 1);
      const fromNumber =
        request.query.from !== undefined ? Number(request.query.from) : defaultFrom;

      const from = resolveVersion(entry, fromNumber);
      const to = resolveVersion(entry, toNumber);

      const fromRendered = fastify.rendering.render(from.commit, from.body);
      const toRendered = fastify.rendering.render(to.commit, to.body);
      const diff = fastify.rendering.diff(
        from.commit,
        to.commit,
        fromRendered.blocks,
        toRendered.blocks,
      );

      return { from: from.number, to: to.number, summary: diff.summary, blocks: diff.blocks };
    },
  );
};

export default adminVersionsRoute;
