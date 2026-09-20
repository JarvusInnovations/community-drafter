import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const MAGIC_CODE_LENGTH = 24;

/** 24 random base62 characters, unbiased (rejection sampling over the byte range). */
export function newMagicCode(): string {
  let out = "";
  while (out.length < MAGIC_CODE_LENGTH) {
    for (const byte of randomBytes(32)) {
      if (byte >= 248) continue; // 248 = 4 × 62; drop the biased tail
      out += ALPHABET[byte % 62];
      if (out.length === MAGIC_CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * `specs/api/auth.md` § `POST /auth/login`: the emailed link carries "24
 * random base62 characters that maps, in memory and for 15 minutes, to the
 * signed magic token; the token itself never appears in a URL or an email".
 * Codes are single-use: `take()` resolves and deletes in one step.
 */
export class MagicCodeStore {
  private readonly entries = new Map<string, { token: string; expiresAtMs: number }>();

  private sweep(): void {
    const now = Date.now();
    for (const [code, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(code);
    }
  }

  put(token: string, expiresAtMs: number): string {
    this.sweep();
    const code = newMagicCode();
    this.entries.set(code, { token, expiresAtMs });
    return code;
  }

  /** Resolves a code to its token and forgets the code; `null` when unknown or expired. */
  take(code: string): string | null {
    this.sweep();
    const entry = this.entries.get(code);
    if (!entry) return null;
    this.entries.delete(code);
    return entry.token;
  }

  /** Test-only: read without consuming. */
  peek(code: string): string | null {
    this.sweep();
    return this.entries.get(code)?.token ?? null;
  }

  /** Test-only. */
  clear(): void {
    this.entries.clear();
  }
}
