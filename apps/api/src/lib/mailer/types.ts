/**
 * `specs/behaviors/notifications.md` § Channels: "email (phase 1): via the
 * configured `Mailer`." One interface, three adapters (`postmark.ts`,
 * `smtp.ts`, `export.ts`) selected by `MAILER` (`plugins/env.ts`). Every
 * event-key template (`../../notifications/templates.ts`) renders down to
 * exactly this shape, so the dispatcher never needs to know which adapter is
 * behind `fastify.mailer`.
 */
export interface MailAddress {
  name: string;
  email: string;
}

export interface OutboundMessage {
  to: MailAddress;
  from: MailAddress;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /**
   * The recipient's personal link, carried alongside the rendered body so
   * the `export` adapter can put it in its own `link` column without
   * re-parsing HTML/text (`specs/architecture.md` § Outbound messaging: CSV
   * of `name,email,subject,link`). Postmark/SMTP ignore it — the link is
   * already inline in `text`/`html`.
   */
  personalLink?: string;
}

/** Thrown by an adapter for a delivery failure the dispatcher should retry. */
export class MailerError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MailerError";
  }
}

export interface Mailer {
  /** The configured `MAILER` value this instance implements. */
  readonly kind: "postmark" | "smtp" | "export";
  send(message: OutboundMessage): Promise<void>;
}
