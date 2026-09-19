import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

/**
 * `specs/data-model.md`'s `submissions.comments[]` deliberately has no
 * `saved_at` field ("What is deliberately not here": "No `created_at` /
 * `updated_at` fields anywhere; the history has them") — timing is a git-log
 * fact. But `git log` alone can't say *which* comment a given `Action:
 * comment` commit touched (the trailer set only names the submission, not a
 * comment id), and the read model's `SubmissionTiming.savedAt` is therefore
 * only accurate at the *submission* granularity.
 *
 * This in-memory tracker fills the gap for the one thing that needs
 * comment-level precision: the three-layer save path's conflict rule
 * (`specs/behaviors/review-and-judgement.md` — "the client compares
 * `saved_at` and keeps the newer text"). Every draft comment write records
 * its own commit's timestamp here, keyed by the exact comment; `PUT
 * draft/comments/:id`'s `stale_edit` check and `GET draft`'s per-comment
 * `saved_at` both read it, falling back to the submission-level timing when
 * a comment predates this process's uptime. Lost on restart — acceptable
 * for the same reason `IdempotencyCache` accepts it (`lib/idempotency.ts`):
 * a restart means nothing could have raced against an in-flight edit across
 * it, so the fallback (submission-level timing) is never actually wrong,
 * only less precise.
 */
export class CommentTimingTracker {
  private readonly store = new Map<string, string>();

  private key(document: string, submissionId: string, commentId: string): string {
    return `${document}/${submissionId}/${commentId}`;
  }

  record(document: string, submissionId: string, commentId: string, savedAt: string): void {
    this.store.set(this.key(document, submissionId, commentId), savedAt);
  }

  get(document: string, submissionId: string, commentId: string): string | undefined {
    return this.store.get(this.key(document, submissionId, commentId));
  }

  clear(document: string, submissionId: string, commentId: string): void {
    this.store.delete(this.key(document, submissionId, commentId));
  }
}

declare module "fastify" {
  interface FastifyInstance {
    commentTiming: CommentTimingTracker;
  }
}

const commentTimingPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("commentTiming", new CommentTimingTracker());
};

export default fp(commentTimingPlugin, "5.x");
