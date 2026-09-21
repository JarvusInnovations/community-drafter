import type { DeadlineChange, Judgement } from "@community-drafter/shared";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

/**
 * `plans/api-core.md` § Approach 5-6: "notification hooks emit typed events
 * onto an in-process bus that `notifications` consumes." This plan owns
 * emitting the events at the right lifecycle points (sign/revoke/decline,
 * publish, the phase clock) and — for the handful of cases its own
 * endpoints must answer synchronously (invitation CSV export, publish's
 * `notified` counts) — computing recipients and writing the `Action: send`
 * idempotency commit itself (`lib/notify.ts`). The general async consumer
 * that renders and sends every other subscription message (`v<n>`,
 * `digest-<date>`, phase-change broadcasts, …) is the `notifications`
 * plan's addition; this bus is where it attaches.
 *
 * Invitations and reminders deliberately have no event here: their
 * endpoints must report what the mailer accepted
 * (`specs/behaviors/notifications.md` § Sending), which means calling
 * `fastify.notifications.deliver` and reading its summary, not announcing
 * an intention.
 */
/**
 * One deadline moved by an `extend` or `reopen`. Defined alongside the
 * trailer set it is written as (`packages/shared`) and re-exported here,
 * because the event and the commit carry the same shape.
 */
export type { DeadlineChange };

export type DrafterEvent =
  | { type: "sign"; document: string; person: string; commit: string }
  | { type: "resign"; document: string; person: string; commit: string }
  | { type: "revoke"; document: string; person: string; commit: string; reason?: string }
  /**
   * A signature's display fields were edited (`specs/behaviors/
   * signatures.md` § Changing how a signature is listed). Distinct from
   * `sign`, which is a signature event: this one changes only how an
   * existing signature is named, and its message says so.
   */
  | { type: "listing-changed"; document: string; person: string; commit: string }
  | { type: "decline"; document: string; person: string; commit: string; reason?: string }
  | {
      type: "submit";
      document: string;
      person: string;
      commit: string;
      submission: string;
      judgement: Judgement;
    }
  | { type: "publish"; document: string; version: number; commit: string; final: boolean }
  | {
      type: "schedule-changed";
      document: string;
      commit: string;
      /**
       * What moved, so `schedule-changed` can say so (`specs/behaviors/
       * notifications.md` § Content rules; `specs/behaviors/
       * document-lifecycle.md` § Extension: "announced ... with old and new
       * times"). `from` is absent when the deadline had none before.
       */
      changes?: DeadlineChange[];
    }
  | { type: "signing-opened"; document: string }
  | { type: "closed"; document: string };

export type DrafterEventListener = (event: DrafterEvent) => void | Promise<void>;

export class EventBus {
  private readonly listeners = new Set<DrafterEventListener>();

  /**
   * `async` (rather than fire-and-forget) so a caller that needs its
   * side effects to have landed before it responds — the `notifications`
   * plan's dispatcher listener, in particular — can `await` it; every
   * existing call site that doesn't need that still works unchanged
   * (an un-awaited call just doesn't wait, same as before).
   */
  async publish(event: DrafterEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  on(listener: DrafterEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

declare module "fastify" {
  interface FastifyInstance {
    events: EventBus;
  }
}

const eventsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("events", new EventBus());
};

export default fp(eventsPlugin, "5.x");
