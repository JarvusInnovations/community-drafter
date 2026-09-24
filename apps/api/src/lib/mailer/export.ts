import { toCsv } from "../csv.ts";
import type { Mailer, OutboundMessage } from "./types.ts";

/**
 * `specs/behaviors/notifications.md` § Channels: "export: when the mailer is
 * `export`, 'sending' writes rows to a CSV the admin can mail-merge and
 * marks `notified` as if sent." `notified` marking is the dispatcher's job
 * (identical across every `Mailer` kind); this adapter's job is just the
 * `name,email,subject,link` row — kept in memory for callers that want it
 * back (e.g. a future bulk-export response) and appended to `filePath` when
 * one is configured (`EXPORT_CSV_PATH`, `plugins/env.ts`) so rows survive
 * process restarts and accumulate across triggers/documents.
 */
export class ExportMailer implements Mailer {
  readonly kind = "export" as const;
  private readonly rows: Array<{ name: string; email: string; subject: string; link: string }> = [];
  private headerWritten = false;

  constructor(private readonly filePath?: string) {}

  async send(message: OutboundMessage): Promise<void> {
    const row = {
      name: message.to.name,
      email: message.to.email,
      subject: message.subject,
      link: message.personalLink ?? "",
    };
    this.rows.push(row);

    if (this.filePath) {
      const csv = toCsv(this.headerWritten ? [] : ["name", "email", "subject", "link"], [
        [row.name, row.email, row.subject, row.link],
      ]);
      const file = Bun.file(this.filePath);
      const exists = await file.exists();
      const existing = exists ? await file.text() : "";
      await Bun.write(this.filePath, existing + csv);
      this.headerWritten = true;
    }
  }

  /** Every row sent so far this process, oldest first. Doesn't drain. */
  peek(): ReadonlyArray<{ name: string; email: string; subject: string; link: string }> {
    return this.rows;
  }

  /** All rows sent so far, as a CSV string with a header row. */
  toCsv(): string {
    return toCsv(
      ["name", "email", "subject", "link"],
      this.rows.map((row) => [row.name, row.email, row.subject, row.link]),
    );
  }
}
