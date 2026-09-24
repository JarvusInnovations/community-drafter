import { AnchorSchema, placeAnchor, type Anchor } from "@signatories/shared";
import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { findDraft } from "../../lib/drafts.ts";
import { mintSubmissionId, nextCommentId } from "../../lib/ids.ts";
import { withIdempotency } from "../../lib/idempotency.ts";
import { buildSubmissionView } from "../../lib/submission-view.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { assertPhase } from "../../phase/phase.ts";
import { loadParticipantContext } from "./context.ts";

interface DraftCommentBody {
  version: number;
  anchor?: unknown;
  body: string;
  client_id: string;
}

interface DraftCommentPatchBody {
  body: string;
  anchor?: unknown;
  base_saved_at?: string;
}

interface DraftCommentParams {
  id: string;
}

interface RebaseBody {
  to_version: number;
}

const draftCommentBodySchema = {
  type: "object",
  required: ["version", "body", "client_id"],
  properties: {
    version: { type: "integer" },
    body: { type: "string" },
    client_id: { type: "string", minLength: 1 },
    anchor: { type: "object" },
  },
} as const;

const draftCommentPatchSchema = {
  type: "object",
  required: ["body"],
  properties: {
    body: { type: "string" },
    anchor: { type: "object" },
    base_saved_at: { type: "string" },
  },
} as const;

/** Validates an optional wire `anchor`, throwing `invalid_anchor` per `specs/api/conventions.md`. */
function parseAnchor(anchor: unknown): Anchor | undefined {
  if (anchor === undefined) return undefined;
  const result = AnchorSchema.safeParse(anchor);
  if (!result.success) {
    throw new ApiError("invalid_anchor", "That comment's anchor isn't valid.", {
      issues: result.error.issues,
    });
  }
  return result.data;
}

/**
 * `specs/api/participant.md` § Draft submission endpoints +
 * `specs/behaviors/review-and-judgement.md` § "Three layers, no gaps": every
 * handler here responds only after its commit lands, carrying `saved_at` so
 * the client can clear its browser buffer and resolve conflicts. All are
 * commenting-phase only (`phase.ts`'s `save_comment`).
 */
const draftRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/draft", { config: PARTICIPANT_ROUTE }, async (request) => {
    const { document, participation } = loadParticipantContext(fastify, request);
    const draft = findDraft(fastify, document.record.slug, participation.record.person);
    return draft ? buildSubmissionView(fastify, draft) : null;
  });

  fastify.post<{ Body: DraftCommentBody }>(
    "/draft/comments",
    { config: PARTICIPANT_ROUTE, schema: { body: draftCommentBodySchema } },
    async (request, reply) => {
      const { document, participation } = loadParticipantContext(fastify, request);
      assertPhase(document.record, new Date(), "save_comment");

      const slug = document.record.slug;
      const person = participation.record.person;
      const token = participation.record.token;
      const clientId = request.body.client_id;

      // `client_id` idempotency (`specs/api/participant.md`): a retried
      // create with the same key returns the original result rather than
      // minting a second comment.
      const idemKey = `draft-comment-create:${token}:${clientId}`;
      const cached = fastify.idempotency.get(idemKey);
      if (cached) {
        reply.status(cached.status);
        return cached.body;
      }

      const anchor = parseAnchor(request.body.anchor);
      const existing = findDraft(fastify, slug, person);
      const version = existing
        ? existing.record.version
        : resolveVersion(document, request.body.version).number;
      const id = existing?.record.id ?? mintSubmissionId(fastify, slug, person);
      const priorComments = existing?.record.comments ?? [];
      const commentId = nextCommentId(priorComments);

      const comments = [...priorComments, { id: commentId, anchor, body: request.body.body }];

      await fastify.storage.commit(
        "comment",
        {
          actor: { kind: "participant" },
          subject: `comment: ${person} on ${slug} (${id})`,
          document: slug,
          person,
          submission: id,
          version,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.submissions.upsert({
            document: slug,
            id,
            person,
            version,
            state: "draft",
            comments,
          });
        },
      );

      // `git log`'s committer dates are second-resolution
      // (`specs/data-model.md`'s versions carry the same caveat elsewhere in
      // this codebase); the conflict rule needs to tell apart two saves in
      // the same second, so `saved_at` is the wall-clock instant the commit
      // acknowledged, not the commit's own (coarser) timestamp.
      const savedAt = new Date().toISOString();
      fastify.commentTiming.record(slug, id, commentId, savedAt);

      const body = { submission: id, id: commentId, saved_at: savedAt };
      fastify.idempotency.set(idemKey, 200, body);
      return body;
    },
  );

  fastify.put<{ Body: DraftCommentPatchBody; Params: DraftCommentParams }>(
    "/draft/comments/:id",
    { config: PARTICIPANT_ROUTE, schema: { body: draftCommentPatchSchema } },
    async (request, reply) => {
      const { document, participation } = loadParticipantContext(fastify, request);
      const slug = document.record.slug;
      const person = participation.record.person;
      const commentId = request.params.id;

      return withIdempotency(
        fastify,
        request,
        reply,
        `draft-comment-put:${participation.record.token}:${commentId}`,
        async () => {
          assertPhase(document.record, new Date(), "save_comment");

          const draft = findDraft(fastify, slug, person);
          const target = draft?.record.comments?.find((comment) => comment.id === commentId);
          if (!draft || !target) {
            throw new ApiError("not_found", "That comment doesn't exist in your draft.");
          }

          // Conflict rule (`specs/behaviors/review-and-judgement.md`): "a
          // server copy never overwrites a newer local edit" — read the
          // other direction here, a stale *client* edit never overwrites a
          // newer server copy.
          const currentSavedAt = fastify.commentTiming.get(slug, draft.record.id, commentId);
          if (
            currentSavedAt &&
            request.body.base_saved_at &&
            request.body.base_saved_at < currentSavedAt
          ) {
            throw new ApiError("stale_edit", "This comment changed since you last loaded it.", {
              comment: { ...target, saved_at: currentSavedAt },
            });
          }

          const anchor = parseAnchor(request.body.anchor) ?? target.anchor;
          const comments = (draft.record.comments ?? []).map((comment) =>
            comment.id === commentId ? { ...comment, body: request.body.body, anchor } : comment,
          );

          await fastify.storage.commit(
            "comment",
            {
              actor: { kind: "participant" },
              subject: `comment: ${person} on ${slug} (${draft.record.id})`,
              document: slug,
              person,
              submission: draft.record.id,
              version: draft.record.version,
              requestId: request.requestId,
            },
            async (tx) => {
              await tx.submissions.upsert({ ...draft.record, comments });
            },
          );

          const savedAt = new Date().toISOString();
          fastify.commentTiming.record(slug, draft.record.id, commentId, savedAt);

          return { saved_at: savedAt };
        },
      );
    },
  );

  fastify.delete<{ Params: DraftCommentParams }>(
    "/draft/comments/:id",
    { config: PARTICIPANT_ROUTE },
    async (request, reply): Promise<void> => {
      const { document, participation } = loadParticipantContext(fastify, request);
      assertPhase(document.record, new Date(), "save_comment");

      const slug = document.record.slug;
      const person = participation.record.person;
      const commentId = request.params.id;

      const draft = findDraft(fastify, slug, person);
      const target = draft?.record.comments?.find((comment) => comment.id === commentId);
      if (!draft || !target) {
        throw new ApiError("not_found", "That comment doesn't exist in your draft.");
      }

      const comments = (draft.record.comments ?? []).filter((comment) => comment.id !== commentId);

      await fastify.storage.commit(
        "comment",
        {
          actor: { kind: "participant" },
          subject: `comment: ${person} on ${slug} (${draft.record.id})`,
          document: slug,
          person,
          submission: draft.record.id,
          version: draft.record.version,
          requestId: request.requestId,
        },
        async (tx) => {
          // "Deleting the last comment deletes the draft"
          // (`specs/api/participant.md`).
          if (comments.length === 0) {
            await tx.submissions.delete(draft.record);
            return;
          }
          await tx.submissions.upsert({ ...draft.record, comments });
        },
      );

      fastify.commentTiming.clear(slug, draft.record.id, commentId);
      await reply.status(204).send();
    },
  );

  fastify.post<{ Body: RebaseBody }>(
    "/draft/rebase",
    { config: PARTICIPANT_ROUTE },
    async (request) => {
      const { document, participation } = loadParticipantContext(fastify, request);
      assertPhase(document.record, new Date(), "save_comment");

      const slug = document.record.slug;
      const person = participation.record.person;

      const draft = findDraft(fastify, slug, person);
      if (!draft) {
        throw new ApiError("not_found", "You don't have a draft to move.");
      }

      const target = resolveVersion(document, request.body.to_version);

      await fastify.storage.commit(
        "comment",
        {
          actor: { kind: "participant" },
          subject: `comment: ${person} on ${slug} (${draft.record.id}, moved to v${target.number})`,
          document: slug,
          person,
          submission: draft.record.id,
          version: target.number,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.submissions.upsert({ ...draft.record, version: target.number });
        },
      );

      // `specs/behaviors/inline-comments.md`: "Re-anchoring results are
      // never written back; they are computed per render" — the anchors
      // themselves are untouched; this only reports placement for the
      // response (the client re-derives the same thing on every render).
      const rendered = fastify.rendering.render(target.commit, target.body);
      const placements = (draft.record.comments ?? []).map((comment) => ({
        id: comment.id,
        placed: comment.anchor
          ? placeAnchor(comment.anchor, rendered.blocks, target.number) !== null
          : true,
      }));

      return { submission: draft.record.id, version: target.number, comments: placements };
    },
  );
};

export default draftRoute;
