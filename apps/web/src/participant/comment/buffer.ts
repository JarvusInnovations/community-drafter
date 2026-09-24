/**
 * The first of the "three layers, no gaps"
 * (`specs/behaviors/review-and-judgement.md`): while a composer has text in
 * it, it's buffered here — local storage when available, else an in-memory
 * fallback — keyed by document, person and comment id, so a reload or crash
 * restores it. Every read/write is wrapped in try/catch per that spec's own
 * wording ("local storage when available, else memory"): a private window,
 * blocked site storage, or a full quota should degrade to the memory
 * fallback, never throw through to the caller.
 */
export interface BufferEntry {
  body: string;
  anchor?: unknown;
  /** When this buffer entry was last written locally (ISO 8601). */
  updatedAt: string;
}

function probeLocalStorage(): boolean {
  try {
    const key = "__drafter_comment_buffer_probe__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export class CommentBuffer {
  private readonly memory = new Map<string, BufferEntry>();
  private readonly useLocalStorage: boolean;
  private readonly prefix: string;

  constructor(documentSlug: string, person: string) {
    this.prefix = `drafter:comment-buffer:${documentSlug}:${person}:`;
    this.useLocalStorage = typeof window !== "undefined" && probeLocalStorage();
  }

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  get(id: string): BufferEntry | undefined {
    if (this.useLocalStorage) {
      try {
        const raw = window.localStorage.getItem(this.key(id));
        return raw ? (JSON.parse(raw) as BufferEntry) : undefined;
      } catch {
        return undefined;
      }
    }
    return this.memory.get(id);
  }

  set(id: string, entry: BufferEntry): void {
    if (this.useLocalStorage) {
      try {
        window.localStorage.setItem(this.key(id), JSON.stringify(entry));
        return;
      } catch {
        // Fall through to the memory fallback (quota exceeded, etc).
      }
    }
    this.memory.set(id, entry);
  }

  clear(id: string): void {
    if (this.useLocalStorage) {
      try {
        window.localStorage.removeItem(this.key(id));
        return;
      } catch {
        // Ignored — worst case the stale entry lingers until overwritten.
      }
    }
    this.memory.delete(id);
  }

  /** Every buffered item for this document/person, e.g. after a reload. */
  list(): { id: string; entry: BufferEntry }[] {
    if (this.useLocalStorage) {
      try {
        const out: { id: string; entry: BufferEntry }[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key || !key.startsWith(this.prefix)) {
            continue;
          }
          const raw = window.localStorage.getItem(key);
          if (!raw) {
            continue;
          }
          try {
            out.push({ id: key.slice(this.prefix.length), entry: JSON.parse(raw) as BufferEntry });
          } catch {
            // Corrupt entry — skip it rather than fail the whole restore.
          }
        }
        return out;
      } catch {
        return [];
      }
    }
    return [...this.memory.entries()].map(([id, entry]) => ({ id, entry }));
  }
}
