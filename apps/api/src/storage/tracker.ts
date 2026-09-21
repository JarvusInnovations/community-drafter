import type { Action } from "@signatories/shared";

import type { Actor } from "./actor.ts";
import type { CommitInput, CommitResult, DataStoreTx } from "./commit.ts";

export type CommitFn = <T>(
  action: Action,
  input: CommitInput,
  fn: (tx: DataStoreTx) => Promise<T>,
) => Promise<CommitResult<T>>;

interface PendingOpen {
  document: string;
  person: string;
  first_opened_at: string;
  last_seen_at: string;
  opensIncrement: number;
}

const TRACKER_ACTOR: Actor = { kind: "system" };

/**
 * `specs/architecture.md` § Storage: "Batched commits (write-behind, at most
 * every 60 seconds and on shutdown) only for open/seen tracking on
 * participations (`Action: track`). A crash loses at most one interval of
 * open counts, nothing else." `record()` is synchronous and in-memory;
 * `flush()` commits every pending delta as one commit.
 */
export class OpenTracker {
  private pending = new Map<string, PendingOpen>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<CommitResult<void> | null> | undefined;

  constructor(
    private readonly commit: CommitFn,
    private readonly intervalMs = 60_000,
  ) {}

  /** Record one open/seen event. Never touches disk or git. */
  record(document: string, person: string, at: Date = new Date()): void {
    const key = `${document}/${person}`;
    const iso = at.toISOString();
    const existing = this.pending.get(key);
    if (existing) {
      existing.last_seen_at = iso;
      existing.opensIncrement += 1;
    } else {
      this.pending.set(key, {
        document,
        person,
        first_opened_at: iso,
        last_seen_at: iso,
        opensIncrement: 1,
      });
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);
    // Don't hold the event loop open just for the tracker in tests/CLI use.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Flush pending deltas as one `Action: track` commit. No-op if nothing is pending. */
  async flush(): Promise<CommitResult<void> | null> {
    // Serialize concurrent flush calls (timer tick racing a shutdown flush).
    if (this.flushing) return this.flushing;

    if (this.pending.size === 0) return null;
    const batch = [...this.pending.values()];
    this.pending.clear();

    this.flushing = this.doFlush(batch).finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async doFlush(batch: PendingOpen[]): Promise<CommitResult<void>> {
    const subject = `track: opens for ${batch.length} participation${batch.length === 1 ? "" : "s"}`;

    return this.commit("track", { actor: TRACKER_ACTOR, subject }, async (tx) => {
      for (const delta of batch) {
        const current = await tx.participations.queryFirst({
          document: delta.document,
          person: delta.person,
        });
        if (!current) continue; // participation gone (revoked/removed) since the open was recorded

        const patch: Record<string, unknown> = {
          last_seen_at: delta.last_seen_at,
          opens: (current.opens ?? 0) + delta.opensIncrement,
        };
        if (!current.first_opened_at) patch.first_opened_at = delta.first_opened_at;

        await tx.participations.patch({ document: delta.document, person: delta.person }, patch);
      }
    });
  }
}
