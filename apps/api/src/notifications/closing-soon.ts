import type { FastifyInstance } from "fastify";

import { derivePhase } from "../phase/phase.ts";
import { clockMessageRecipients } from "./triggers.ts";
import { closingSoonTemplate } from "./templates.ts";

const OBSERVER_ACTOR = { kind: "system" } as const;
const HOUR_MS = 60 * 60 * 1000;
/** `specs/behaviors/notifications.md` § Sending: "24 hours before `signing_closes_at`". */
const LEAD_MS = 24 * HOUR_MS;
/** Same section: "the six hours following this document's `signing-opened` send". */
const QUIET_PERIOD_MS = 6 * HOUR_MS;

/**
 * `specs/behaviors/notifications.md` § Sending, "`closing-soon` keeps its
 * distance from `signing-opened`". Ticks independently of `PhaseObserver`
 * (which only flips `state = closed` and fires `signing-opened`/`closed`)
 * since this is a lead-time warning, not a boundary crossing —
 * self-throttled by the `notified.closing-soon` idempotency check in
 * `dispatcher.deliver`, so a re-tick after the window moves later (an admin
 * `schedule`/`reopen`) simply finds nothing new to send.
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

      const closesAt = new Date(record.signing_closes_at).getTime();
      const dueAt = this.dueAt(record.slug, record.comments_close_at, closesAt);
      // `undefined` means this window has no eligible moment at all — the
      // spec's two-hour case, where the quiet period outlasts the window.
      if (dueAt === undefined) continue;
      if (now.getTime() < dueAt) continue;

      const recipients = clockMessageRecipients(this.fastify, record.slug);
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

  /**
   * The moment `closing-soon` becomes sendable for this window, or
   * `undefined` when there is none before `signing_closes_at`:
   * the scheduled time (24 hours before close, or the window's midpoint
   * when the whole window is shorter than that), pushed out to the end of
   * the quiet period that follows the `signing-opened` send.
   */
  private dueAt(
    slug: string,
    commentsCloseAt: string | undefined,
    closesAt: number,
  ): number | undefined {
    const opensAt = commentsCloseAt ? new Date(commentsCloseAt).getTime() : undefined;
    const windowMs = opensAt === undefined ? undefined : closesAt - opensAt;
    const scheduledAt =
      opensAt !== undefined && windowMs !== undefined && windowMs > 0 && windowMs < LEAD_MS
        ? opensAt + windowMs / 2
        : closesAt - LEAD_MS;

    const signingOpenedAt = this.signingOpenedSentAt(slug);
    const dueAt =
      signingOpenedAt === undefined
        ? scheduledAt
        : Math.max(scheduledAt, signingOpenedAt + QUIET_PERIOD_MS);

    return dueAt < closesAt ? dueAt : undefined;
  }

  /**
   * When this document sent `signing-opened`, read from the earliest
   * `notified["signing-opened"]` its participations carry — the record of
   * the send is the only place that moment exists, and the earliest of them
   * anchors the quiet period to the original batch rather than to a
   * straggler picked up by a later retry. `undefined` when the message
   * reached nobody, in which case there is no quiet period.
   */
  private signingOpenedSentAt(slug: string): number | undefined {
    let earliest: number | undefined;
    for (const entry of this.fastify.storage.readModel.listParticipationsForDocument(slug)) {
      const value = entry.record.notified?.["signing-opened"];
      if (typeof value !== "string") continue;
      const at = new Date(value).getTime();
      if (Number.isNaN(at)) continue;
      if (earliest === undefined || at < earliest) earliest = at;
    }
    return earliest;
  }
}
