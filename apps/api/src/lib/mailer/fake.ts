import { MailerError, type Mailer, type OutboundMessage } from "./types.ts";

/**
 * Test-only `Mailer` that records every send instead of touching the
 * network. `failNextFor(email, times)` makes the next N sends to that
 * address throw `MailerError`, so tests can exercise the dispatcher's
 * retry/backoff and failure bookkeeping without a real provider.
 * `rejectFrom(address)` refuses every message sent **From** that address,
 * which is how a real provider answers a sender nobody has verified
 * (`specs/behaviors/sites.md` § Mail).
 */
export class FakeMailer implements Mailer {
  readonly kind = "export" as const;
  readonly sent: OutboundMessage[] = [];
  private readonly failuresRemaining = new Map<string, number>();
  private readonly unverifiedSenders = new Set<string>();

  async send(message: OutboundMessage): Promise<void> {
    if (this.unverifiedSenders.has(message.from.email)) {
      throw new MailerError(
        `FakeMailer: ${message.from.email} is not a verified sender for this account`,
      );
    }
    const remaining = this.failuresRemaining.get(message.to.email) ?? 0;
    if (remaining > 0) {
      this.failuresRemaining.set(message.to.email, remaining - 1);
      throw new MailerError(`FakeMailer: forced failure for ${message.to.email}`);
    }
    this.sent.push(message);
  }

  failNextFor(email: string, times: number): void {
    this.failuresRemaining.set(email, times);
  }

  /** Refuse every message From this address, the way a provider refuses an unverified sender. */
  rejectFrom(address: string): void {
    this.unverifiedSenders.add(address);
  }
}
