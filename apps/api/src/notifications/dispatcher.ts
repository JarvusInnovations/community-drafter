import type { FastifyInstance } from "fastify";

import type { Actor } from "../storage/actor.ts";
import { buildRecipientContext } from "./context.ts";
import type { Mailer, OutboundMessage } from "../lib/mailer/index.ts";
import type { RecipientContext, TemplateResult } from "./types.ts";

export interface DeliverTarget {
  person: string;
  /**
   * `true`: this dispatcher owns the `notified` check-and-mark for this
   * recipient, writing it only for messages the mailer accepted — the
   * normal path (`invitation`, `signing-opened`, `closed`, `closing-soon`,
   * `schedule-changed`, digest, sign/revoke/review-receipt confirmations,
   * `final-published` for commenters). `false`: the caller marked
   * `notified` itself in the commit that triggered this send
   * (publish-triggered `v<n>`/`disposition-v<n>`/`final-published` for
   * signers — see `lib/notify.ts`) or records its own bookkeeping from the
   * `sentPeople` this call returns (`remind`) — the dispatcher only renders
   * and sends, never marks.
   */
  markNotified: boolean;
  render: (ctx: RecipientContext) => TemplateResult;
}

export interface DeliverOptions {
  document: string;
  eventKey: string;
  actor: Actor;
  requestId?: string;
  targets: DeliverTarget[];
  /**
   * The `participations.notified` field this batch checks/writes, if
   * different from `eventKey` — only the daily digest needs this: its
   * failure-bucket/display key is `digest-<date>` (`specs/behaviors/
   * notifications.md`'s table) but the field it actually reads/writes is
   * the single mutable `notified.digest` (`specs/data-model.md`:
   * `notified.digest = "2026-09-21"`). Defaults to `eventKey`.
   */
  notifiedField?: string;
  /** The value written to `notified[notifiedField]` on success. Defaults to `new Date().toISOString()`. */
  notifiedValue?: string;
  /**
   * Whether the current `notified[notifiedField]` value counts as "already
   * sent" for a `markNotified` target. Defaults to "is set at all" — the
   * digest overrides this to "is set to *today's* date", since the field
   * holds the last-sent date, not a boolean.
   */
  isAlreadyNotified?: (current: string | number | undefined) => boolean;
  /**
   * Extra `participations` fields patched alongside `notified` in the same
   * success commit, for `markNotified` targets only. `specs/behaviors/
   * notifications.md` § Sending: an invitation's `sent_at` "is written in
   * the *same* commit as `notified.invitation`", so a person the mailer
   * rejected is left genuinely unsent rather than merely unrecorded.
   */
  alsoSet?: Record<string, unknown>;
}

export interface DeliverSummary {
  sent: number;
  failed: number;
  skipped: number;
  /** Who the mailer accepted a message for, so a caller can report names, not a queue depth. */
  sentPeople: string[];
  /** Who it rejected, with the error from the last attempt. */
  failures: Array<{ person: string; error: string }>;
  /** The `Action: send` commit that recorded the successes; `null` when nothing was marked. */
  commit: string | null;
}

interface FailureRecord {
  eventKey: string;
  person: string;
  attempts: number;
  lastError: string;
  at: string;
  markNotified: boolean;
  render: (ctx: RecipientContext) => TemplateResult;
  notifiedField: string;
  notifiedValue: string;
  isAlreadyNotified: (current: string | number | undefined) => boolean;
  alsoSet: Record<string, unknown> | undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `specs/behaviors/notifications.md` § Sending — the async consumer that
 * renders and sends every event key, with retries and the `notified`
 * idempotency/batching rules. One instance per server, decorated as
 * `fastify.notifications` (`plugin.ts`).
 */
export class NotificationDispatcher {
  /** `<document>:<eventKey>` → person → failure record (survives across ticks; cleared by app restart, per spec: "shown in the dashboard from memory"). */
  private readonly failures = new Map<string, Map<string, FailureRecord>>();

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly mailer: Mailer,
    private readonly retry_ = { attempts: 3, baseDelayMs: 150 },
  ) {}

  private failureBucketKey(document: string, eventKey: string): string {
    return `${document}:${eventKey}`;
  }

  private recordFailure(record: FailureRecord, document: string): void {
    const key = this.failureBucketKey(document, record.eventKey);
    const bucket = this.failures.get(key) ?? new Map<string, FailureRecord>();
    bucket.set(record.person, record);
    this.failures.set(key, bucket);
  }

  private clearFailure(document: string, eventKey: string, person: string): void {
    const key = this.failureBucketKey(document, eventKey);
    this.failures.get(key)?.delete(person);
  }

  /** `GET .../notifications`: every failed send for a document, so the operator can see who and why. */
  failureList(
    document: string,
  ): Array<{ event: string; person: string; error: string; at: string }> {
    const out: Array<{ event: string; person: string; error: string; at: string }> = [];
    for (const [key, bucket] of this.failures) {
      if (!key.startsWith(`${document}:`)) continue;
      for (const record of bucket.values()) {
        out.push({
          event: record.eventKey,
          person: record.person,
          error: record.lastError,
          at: record.at,
        });
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** `GET .../notifications`: failed count for a document (across every event key). */
  failedCount(document: string): number {
    let total = 0;
    for (const [key, bucket] of this.failures) {
      if (key.startsWith(`${document}:`)) total += bucket.size;
    }
    return total;
  }

  private async attemptSend(
    message: OutboundMessage,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    let lastError = "";
    for (let attempt = 0; attempt < this.retry_.attempts; attempt++) {
      try {
        await this.mailer.send(message);
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < this.retry_.attempts - 1) {
          await delay(this.retry_.baseDelayMs * 2 ** attempt);
        }
      }
    }
    return { ok: false, error: lastError };
  }

  private toMessage(ctx: RecipientContext, rendered: TemplateResult): OutboundMessage {
    return {
      to: { name: ctx.personName, email: ctx.personEmail },
      from: { name: ctx.fromName, email: ctx.fromEmail },
      replyTo: ctx.replyTo,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      personalLink: ctx.personalLink,
      tag: ctx.tag,
    };
  }

  /**
   * Render, send (with retry) and — for `markNotified` targets not already
   * marked — batch-commit `notified` once for every recipient this call
   * delivered to (`specs/behaviors/notifications.md`: "recorded in one
   * commit ... never one commit per recipient").
   */
  async deliver(opts: DeliverOptions): Promise<DeliverSummary> {
    const { document, eventKey, actor, requestId, targets } = opts;
    const notifiedField = opts.notifiedField ?? eventKey;
    const notifiedValue = opts.notifiedValue ?? new Date().toISOString();
    const isAlreadyNotified = opts.isAlreadyNotified ?? ((current) => current !== undefined);

    const documentEntry = this.fastify.storage.readModel.getDocument(document);
    if (!documentEntry) {
      return {
        sent: 0,
        failed: 0,
        skipped: targets.length,
        sentPeople: [],
        failures: [],
        commit: null,
      };
    }

    // Outcomes are collected by target index, not pushed as they resolve, so
    // `sentPeople` and `failures` come back in the caller's own order however
    // the concurrent sends interleave.
    const outcomes = await Promise.all(
      targets.map(
        async (
          target,
        ): Promise<{
          person: string;
          state: "sent" | "failed" | "skipped";
          error?: string;
          mark: boolean;
        }> => {
          const participation = this.fastify.storage.readModel.getParticipation(
            document,
            target.person,
          );
          if (!participation) return { person: target.person, state: "skipped", mark: false };
          if (
            target.markNotified &&
            isAlreadyNotified(participation.record.notified?.[notifiedField])
          ) {
            // `specs/behaviors/notifications.md` § Sending: "present means skip."
            return { person: target.person, state: "skipped", mark: false };
          }

          const ctx = buildRecipientContext(this.fastify, documentEntry, participation);
          if (!ctx.personEmail) return { person: target.person, state: "skipped", mark: false };

          const rendered = target.render(ctx);
          const message = this.toMessage(ctx, rendered);
          const result = await this.attemptSend(message);
          // `specs/api/admin.md` § Sites: `sender_verified` is an
          // observation, and this is where one is made.
          this.fastify.siteObservations.recordSend(ctx.tag, result.ok);

          if (result.ok) {
            this.clearFailure(document, eventKey, target.person);
            return { person: target.person, state: "sent", mark: target.markNotified };
          }

          this.fastify.log.warn(
            { document, eventKey, person: target.person, error: result.error },
            "notifications: delivery failed after retries",
          );
          this.recordFailure(
            {
              eventKey,
              person: target.person,
              attempts: this.retry_.attempts,
              lastError: result.error,
              at: new Date().toISOString(),
              markNotified: target.markNotified,
              render: target.render,
              notifiedField,
              notifiedValue,
              isAlreadyNotified,
              alsoSet: opts.alsoSet,
            },
            document,
          );
          return { person: target.person, state: "failed", error: result.error, mark: false };
        },
      ),
    );

    const sentPeople = outcomes.filter((o) => o.state === "sent").map((o) => o.person);
    const failures = outcomes
      .filter((o) => o.state === "failed")
      .map((o) => ({ person: o.person, error: o.error ?? "" }));
    const skipped = outcomes.filter((o) => o.state === "skipped").length;
    const toMark = outcomes.filter((o) => o.mark).map((o) => o.person);

    let commit: string | null = null;
    if (toMark.length > 0) {
      commit = await this.markNotified(
        document,
        notifiedField,
        notifiedValue,
        toMark,
        actor,
        requestId,
        opts.alsoSet,
      );
    }

    return {
      sent: sentPeople.length,
      failed: failures.length,
      skipped,
      sentPeople,
      failures,
      commit,
    };
  }

  private async markNotified(
    document: string,
    notifiedField: string,
    notifiedValue: string,
    people: string[],
    actor: Actor,
    requestId: string | undefined,
    alsoSet: Record<string, unknown> | undefined,
  ): Promise<string | null> {
    const result = await this.fastify.storage.commit(
      "send",
      {
        actor,
        subject: `send: ${notifiedField} for ${document} (${people.length} recipients)`,
        document,
        requestId,
      },
      async (tx) => {
        for (const person of people) {
          const current = await tx.participations.queryFirst({ document, person });
          if (!current) continue;
          await tx.participations.patch(
            { document, person },
            {
              ...alsoSet,
              notified: { ...current.notified, [notifiedField]: notifiedValue },
            },
          );
        }
      },
    );
    return result.commitHash ?? null;
  }

  /**
   * `specs/api/admin.md` § Notifications → `POST .../notifications/retry`:
   * "re-derives and re-dispatches anything not in `notified`." Operates
   * over this dispatcher's own in-memory failure bucket — the only place a
   * genuinely retryable (never-delivered) send is recorded — filtered by
   * the optional `event`/`person`.
   */
  async retry(
    document: string,
    filter: { event?: string; person?: string },
    actor: Actor,
    requestId?: string,
  ): Promise<{ retried: number; sent: number; failed: number }> {
    const candidates: FailureRecord[] = [];
    for (const [key, bucket] of this.failures) {
      if (!key.startsWith(`${document}:`)) continue;
      const eventKey = key.slice(document.length + 1);
      if (filter.event && filter.event !== eventKey) continue;
      for (const record of bucket.values()) {
        if (filter.person && filter.person !== record.person) continue;
        candidates.push(record);
      }
    }

    // `deliver` batches one `notified` commit per `eventKey`; a retry batch
    // can span several event keys, so run each bucket through it separately.
    let sent = 0;
    let failed = 0;
    const byEventKey = new Map<string, FailureRecord[]>();
    for (const record of candidates) {
      const list = byEventKey.get(record.eventKey) ?? [];
      list.push(record);
      byEventKey.set(record.eventKey, list);
    }

    for (const [eventKey, records] of byEventKey) {
      const [sample] = records;
      const result = await this.deliver({
        document,
        eventKey,
        actor,
        requestId,
        notifiedField: sample?.notifiedField,
        notifiedValue: sample?.notifiedValue,
        isAlreadyNotified: sample?.isAlreadyNotified,
        // Carried so a retried invitation still lands `sent_at` with its
        // `notified.invitation` — the two must never disagree about whether
        // this person was reached.
        alsoSet: sample?.alsoSet,
        targets: records.map((record) => ({
          person: record.person,
          markNotified: record.markNotified,
          render: record.render,
        })),
      });
      sent += result.sent;
      failed += result.failed;
    }

    return { retried: candidates.length, sent, failed };
  }
}
