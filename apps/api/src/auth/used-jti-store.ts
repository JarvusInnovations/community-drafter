/**
 * `specs/api/auth.md` § `GET /auth/callback`: "marks the `jti` used." A
 * used magic-link `jti` is remembered in memory until its own expiry
 * (`specs/behaviors/operators.md`: "reuse after a restart within the window
 * is accepted as a known limitation") — no need to remember it any longer
 * than the token itself would have been valid for.
 */
export class UsedJtiStore {
  private readonly usedUntil = new Map<string, number>();

  private sweep(): void {
    const now = Date.now();
    for (const [jti, expiresAtMs] of this.usedUntil) {
      if (expiresAtMs <= now) this.usedUntil.delete(jti);
    }
  }

  isUsed(jti: string): boolean {
    this.sweep();
    return this.usedUntil.has(jti);
  }

  markUsed(jti: string, expiresAtMs: number): void {
    this.usedUntil.set(jti, expiresAtMs);
  }

  /** Test-only: drop every recorded jti. */
  clear(): void {
    this.usedUntil.clear();
  }
}
