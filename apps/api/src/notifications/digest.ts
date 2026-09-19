import type { FastifyInstance } from "fastify";

import { prefOn } from "../lib/notify.ts";
import { computeSignatories } from "../lib/signatories.ts";
import { digestTemplate } from "./templates.ts";
import { dateInTimezone, hourInTimezone } from "./format.ts";

const OBSERVER_ACTOR = { kind: "cli", label: "digest-scheduler" } as const;

/**
 * `specs/behaviors/notifications.md` § Sending: "The digest job runs once
 * daily at a configured hour in the instance time zone" and § Messages:
 * `digest-<date>`, "only if anything changed that day". "Changed" is read
 * as "a version was published today" — dispositions and signatory counts
 * only ever change alongside a publish (`admin.md`'s `POST .../versions` is
 * the only writer of both), so gating on "any version today" also gates
 * the other two facts the digest reports.
 *
 * The idempotency field is `participations.notified.digest`, holding the
 * *last date sent* rather than a boolean — `specs/data-model.md`:
 * `notified.digest = "2026-09-21"` — so re-running after the configured
 * hour on the same day is a no-op (already sent today) and a new day's run
 * sends again even though the field is already set.
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

    for (const documentEntry of this.fastify.storage.readModel.listDocuments()) {
      if (documentEntry.record.state !== "open") continue;
      const slug = documentEntry.record.slug;

      const versionsToday = documentEntry.versions.filter(
        (version) => dateInTimezone(new Date(version.published_at), timezone) === today,
      );
      if (versionsToday.length === 0) continue;

      const participations = this.fastify.storage.readModel.listParticipationsForDocument(slug);
      const recipients = participations
        .filter((entry) => !entry.record.link_revoked)
        .filter((entry) => prefOn(entry, "daily_digest"))
        .filter((entry) => entry.record.notified?.digest !== today)
        .map((entry) => entry.record.person);
      if (recipients.length === 0) continue;

      const signatoryCounts = computeSignatories(participations, "count") ?? {
        organizations: 0,
        individuals: 0,
        unlisted: 0,
      };
      const versionNumbersToday = new Set(versionsToday.map((v) => v.number));

      await this.fastify.notifications.deliver({
        document: slug,
        eventKey: `digest-${today}`,
        notifiedField: "digest",
        notifiedValue: today,
        isAlreadyNotified: (current) => current === today,
        actor: OBSERVER_ACTOR,
        targets: recipients.map((person) => ({
          person,
          markNotified: true,
          render: (ctx) => {
            const participation = participations.find((entry) => entry.record.person === person);
            // `principles.md`/`notifications.md` § Local: "a person hears
            // about a version at most once per channel" — a version this
            // person already got via `every_revision`'s `v<n>` send is
            // omitted from their own digest, even though it's still listed
            // for everyone else who hasn't.
            const versions = versionsToday
              .filter((v) => participation?.record.notified?.[`v${v.number}`] === undefined)
              .map((v) => ({ number: v.number, summary: v.summary }));

            const dispositions = this.fastify.storage.readModel
              .listSubmissionsForDocument(slug)
              .filter((s) => s.record.person === person)
              .flatMap((s) => s.record.comments ?? [])
              .filter(
                (c) =>
                  c.disposition !== undefined &&
                  c.disposition_version !== undefined &&
                  versionNumbersToday.has(c.disposition_version),
              )
              .map((c) => ({ outcome: c.disposition as string, note: c.disposition_note }));
            return digestTemplate(ctx, { versions, dispositions, signatoryCounts });
          },
        })),
      });
    }
  }
}
