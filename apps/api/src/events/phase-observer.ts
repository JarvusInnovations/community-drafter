import type { FastifyInstance } from "fastify";

import { derivePhase } from "../phase/phase.ts";

const OBSERVER_ACTOR = { kind: "system" } as const;

/**
 * `specs/behaviors/document-lifecycle.md`: "closed (state is also flipped
 * to `closed` by the scheduler tick that observes it)".
 * `derivePhase` is a pure read-time function (never mutates); this timer is
 * "the scheduler that observes it" — it walks every open document each
 * tick and flips `state = closed` once `signing_closes_at` has passed (an
 * ordinary `close`-action commit, attributed to `system`). It announces
 * nothing: a phase change is a state change, and state changes don't speak
 * (`specs/principles.md` § Operators speak; state changes don't).
 *
 * It runs on the scheduler tick (`POST /internal/tick`), not on a timer: the
 * service scales to zero, and nothing waits on the flip because every read
 * derives the phase from the clock (`specs/architecture.md` § API server).
 */
export class PhaseObserver {
  constructor(private readonly fastify: FastifyInstance) {}

  /** One observation pass over every document; exposed for tests to call directly. */
  async tick(): Promise<void> {
    const now = new Date();
    for (const entry of this.fastify.storage.readModel.listDocuments()) {
      const { record } = entry;
      if (record.state !== "open") continue;

      if (derivePhase(record, now) === "closed") {
        await this.fastify.storage.commit(
          "close",
          {
            actor: OBSERVER_ACTOR,
            subject: `close: ${record.slug} (signing window elapsed)`,
            document: record.slug,
          },
          async (tx) => {
            await tx.documents.patch({ slug: record.slug }, { state: "closed" });
          },
        );
      }
    }
  }
}
