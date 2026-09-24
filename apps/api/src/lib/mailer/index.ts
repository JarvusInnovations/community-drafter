import { ExportMailer } from "./export.ts";
import { PostmarkMailer } from "./postmark.ts";
import { SmtpMailer } from "./smtp.ts";
import type { Mailer } from "./types.ts";

export type { Mailer, MailAddress, OutboundMessage } from "./types.ts";
export { MailerError } from "./types.ts";
export { ExportMailer } from "./export.ts";
export { PostmarkMailer } from "./postmark.ts";
export { SmtpMailer } from "./smtp.ts";
export { FakeMailer } from "./fake.ts";

export interface MailerFactoryConfig {
  MAILER: "postmark" | "smtp" | "export";
  POSTMARK_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  EXPORT_CSV_PATH?: string;
}

/**
 * `specs/architecture.md` § Outbound messaging via `MAILER`
 * (`plugins/env.ts`). Fails fast at boot with a clear configuration error
 * rather than lazily on the first send — a misconfigured mailer should
 * never surface as a mysterious dispatch failure later.
 */
export function createMailer(config: MailerFactoryConfig): Mailer {
  switch (config.MAILER) {
    case "postmark": {
      if (!config.POSTMARK_API_KEY) {
        throw new Error("MAILER=postmark requires POSTMARK_API_KEY to be set.");
      }
      return new PostmarkMailer(config.POSTMARK_API_KEY);
    }
    case "smtp": {
      if (!config.SMTP_HOST || !config.SMTP_PORT) {
        throw new Error("MAILER=smtp requires SMTP_HOST and SMTP_PORT to be set.");
      }
      return new SmtpMailer({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        user: config.SMTP_USER,
        password: config.SMTP_PASSWORD,
      });
    }
    case "export":
      return new ExportMailer(config.EXPORT_CSV_PATH);
    default:
      throw new Error(`Unknown MAILER value: ${String(config.MAILER)}`);
  }
}
