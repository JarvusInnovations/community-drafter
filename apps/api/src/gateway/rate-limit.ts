/**
 * A small fixed-window counter, not a sliding one — good enough for the two
 * limits `specs/api/conventions.md` § Rate limits names (30/min token-
 * resolution failures per source address, 60/min participant writes per
 * token) without pulling in `@fastify/rate-limit`'s per-request overhead
 * for checks that fire on a *subset* of requests (only resolution
 * failures) rather than every request to a route.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records one hit for `key`; returns `false` once `key` is over budget for this window. */
  hit(key: string, now: number = Date.now()): boolean {
    const entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.max) return false;
    entry.count += 1;
    return true;
  }

  /** Test-only: drop all recorded windows. */
  reset(): void {
    this.windows.clear();
  }
}
