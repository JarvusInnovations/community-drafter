import type { FastifyInstance } from "fastify";

import { dateInTimezone, hourInTimezone } from "./format.ts";
import { sendOperatorDigest } from "./operator-digest.ts";

/**
 * `specs/behaviors/notifications.md` § Sending: "The operator digest runs
 * once daily at a configured hour in the instance time zone. It is the only
 * scheduled sender; nothing scheduled ever mails a participant." The
 * participant digest that used to share this tick is gone
 * (`specs/principles.md` § Every email asks something of its reader).
 *
 * A document is considered when it is open, or when its signing window
 * closed inside the last 24 hours — so the day signing closes is reported
 * to the team even though the phase observer has already flipped the
 * record to `closed`, and likewise a delivery recorded on a closed document.
 */
export class DigestScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly intervalMs = 15 * 60_000,
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
    const timezone = this.fastify.config.INSTANCE_TIMEZONE || "UTC";
    if (hourInTimezone(now, timezone) !== this.fastify.config.INSTANCE_DIGEST_HOUR) return;

    const today = dateInTimezone(now, timezone);
    const sinceMs = now.getTime() - 24 * 60 * 60_000;
    const since = new Date(sinceMs).toISOString();

    for (const documentEntry of this.fastify.storage.readModel.listDocuments()) {
      const { record } = documentEntry;
      const closedInWindow =
        record.state === "closed" &&
        record.signing_closes_at !== undefined &&
        new Date(record.signing_closes_at).getTime() >= sinceMs;
      const deliveredInWindow =
        record.delivered_at !== undefined && new Date(record.delivered_at).getTime() >= sinceMs;
      if (record.state !== "open" && !closedInWindow && !deliveredInWindow) continue;

      try {
        await sendOperatorDigest(this.fastify, documentEntry, today, since, now);
      } catch (err) {
        // Operator mail is logged and never allowed to fail anything
        // (§ Operator mail); one document's digest must not stop the rest.
        this.fastify.log.warn(
          { document: record.slug, err: err instanceof Error ? err.message : String(err) },
          "operator digest: failed",
        );
      }
    }
  }
}
