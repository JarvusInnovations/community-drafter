import type { FastifyInstance } from "fastify";

import { derivePhase, type Phase } from "../phase/phase.ts";

const OBSERVER_ACTOR = { kind: "cli", label: "phase-observer" } as const;

/**
 * `specs/behaviors/document-lifecycle.md`: "closed (state is also flipped
 * to `closed` by the first read or the scheduler that observes it)" and
 * "Comments close on the clock" / signing-opened boundary. `derivePhase` is
 * a pure read-time function (never mutates); this timer is "the scheduler
 * that observes it" — it walks every open document each tick, flips
 * `state = closed` the moment `signing_closes_at` passes (an ordinary
 * `close`-action commit, attributed to the `cli:phase-observer` actor), and
 * emits `signing-opened` / `closed` bus events exactly once per crossing.
 */
export class PhaseObserver {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly lastPhase = new Map<string, Phase>();

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One observation pass over every document; exposed for tests to call directly. */
  async tick(): Promise<void> {
    const now = new Date();
    for (const entry of this.fastify.storage.readModel.listDocuments()) {
      const { record } = entry;
      if (record.state !== "open") continue;

      const phase = derivePhase(record, now);
      const previous = this.lastPhase.get(record.slug);

      if (phase === "signing" && previous === "commenting") {
        await this.fastify.events.publish({ type: "signing-opened", document: record.slug });
      }

      if (phase === "closed") {
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
        await this.fastify.events.publish({ type: "closed", document: record.slug });
      }

      this.lastPhase.set(record.slug, phase);
    }
  }
}
