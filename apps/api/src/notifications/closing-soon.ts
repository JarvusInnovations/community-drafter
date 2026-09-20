import type { FastifyInstance } from "fastify";

import { derivePhase } from "../phase/phase.ts";
import { closingSoonRecipients } from "./triggers.ts";
import { closingSoonTemplate } from "./templates.ts";

const OBSERVER_ACTOR = { kind: "system" } as const;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * `specs/behaviors/notifications.md` § Messages: `closing-soon` fires "24
 * hours before `signing_closes_at`", forced on for current signers. Ticks
 * independently of `PhaseObserver` (which only flips `state = closed` and
 * fires `signing-opened`/`closed`) since this is a lead-time warning, not a
 * boundary crossing — self-throttled by the `notified.closing-soon`
 * idempotency check in `dispatcher.deliver`, so a re-tick after the window
 * moves later (an admin `schedule`/`reopen`) simply finds nothing new to
 * send until the new deadline is itself within 24 hours.
 */
export class ClosingSoonScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly intervalMs = 5 * 60_000,
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

  async tick(): Promise<void> {
    const now = new Date();

    for (const documentEntry of this.fastify.storage.readModel.listDocuments()) {
      const { record } = documentEntry;
      if (record.state !== "open") continue;
      if (derivePhase(record, now) !== "signing") continue;
      if (!record.signing_closes_at) continue;

      const closesAt = new Date(record.signing_closes_at);
      const msUntilClose = closesAt.getTime() - now.getTime();
      if (msUntilClose > TWENTY_FOUR_HOURS_MS || msUntilClose <= 0) continue;

      const recipients = closingSoonRecipients(this.fastify, record.slug);
      if (recipients.length === 0) continue;

      await this.fastify.notifications.deliver({
        document: record.slug,
        eventKey: "closing-soon",
        actor: OBSERVER_ACTOR,
        targets: recipients.map((person) => ({
          person,
          markNotified: true,
          render: (ctx) => closingSoonTemplate(ctx),
        })),
      });
    }
  }
}
