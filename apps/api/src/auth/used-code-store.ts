/**
 * `specs/api/auth.md` § `GET /auth/callback`: "marks the code used". A
 * followed magic-link code is remembered in memory until its own expiry;
 * reuse after a restart within that window is accepted as a known
 * limitation (`specs/behaviors/operators.md`), since replaying it needs the
 * link and the link is the credential. Nothing needs remembering longer
 * than the code itself would have been valid for.
 */
export class UsedCodeStore {
  private readonly usedUntil = new Map<string, number>();

  private sweep(): void {
    const now = Date.now();
    for (const [code, expiresAtMs] of this.usedUntil) {
      if (expiresAtMs <= now) this.usedUntil.delete(code);
    }
  }

  isUsed(code: string): boolean {
    this.sweep();
    return this.usedUntil.has(code);
  }

  markUsed(code: string, expiresAtMs: number): void {
    this.usedUntil.set(code, expiresAtMs);
  }

  /** Test-only: drop every recorded code. */
  clear(): void {
    this.usedUntil.clear();
  }
}
