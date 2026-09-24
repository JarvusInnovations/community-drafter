import nodemailer, { type Transporter } from "nodemailer";

import { formatAddress, MailerError, type Mailer, type OutboundMessage } from "./types.ts";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
}

/**
 * SMTP via `nodemailer` — confirmed to construct and run its transport
 * under Bun (no native bindings; it speaks SMTP over `net`/`tls` sockets
 * directly), so this is a real adapter rather than the stub the plan
 * allowed for if nothing worked. `SMTP_PORT === 465` is treated as implicit
 * TLS (the common convention); anything else negotiates STARTTLS.
 */
export class SmtpMailer implements Mailer {
  readonly kind = "smtp" as const;
  private readonly transporter: Transporter;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });
  }

  async send(message: OutboundMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: formatAddress(message.from),
        to: formatAddress(message.to),
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (err) {
      throw new MailerError("SMTP send failed.", err);
    }
  }
}
