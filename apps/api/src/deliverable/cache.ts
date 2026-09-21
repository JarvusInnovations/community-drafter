/**
 * `specs/architecture.md` § API server: "Renders are cached in memory by
 * document, version commit and a hash of the signatory list, with a short
 * lifetime and a small bound."
 *
 * The key carries every input the render depends on, the signatory list
 * included — so a hit can never serve a stale list, and the lifetime and
 * the bound are purely about memory rather than about correctness. That is
 * what lets `specs/screens/deliverable.md`'s local principle hold with a
 * cache in front of it: the list is computed live on *every* request, and
 * what gets reused is only the drawing of a list that has not changed.
 */
interface Entry {
  bytes: Uint8Array;
  expiresAt: number;
}

export class DeliverableCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly max = 8,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  get(key: string, now: number = Date.now()): Uint8Array | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so the bound evicts the least recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.bytes;
  }

  set(key: string, bytes: Uint8Array, now: number = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { bytes, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
