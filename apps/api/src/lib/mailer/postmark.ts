import { formatAddress, MailerError, type Mailer, type OutboundMessage } from "./types.ts";

/**
 * Postmark's HTTP API (`POST https://api.postmarkapp.com/email`), plain
 * `fetch` rather than a client library — the request body is four fields
 * and a header, not worth a dependency. Auth is the `X-Postmark-Server-Token`
 * header (`POSTMARK_API_KEY`, `plugins/env.ts`).
 */
export class PostmarkMailer implements Mailer {
  readonly kind = "postmark" as const;

  constructor(
    private readonly serverToken: string,
    private readonly endpoint = "https://api.postmarkapp.com/email",
  ) {}

  async send(message: OutboundMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": this.serverToken,
        },
        body: JSON.stringify({
          From: formatAddress(message.from),
          To: formatAddress(message.to),
          ReplyTo: message.replyTo,
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          Tag: message.tag,
          MessageStream: "outbound",
        }),
      });
    } catch (err) {
      throw new MailerError("Postmark request failed to send.", err);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new MailerError(`Postmark responded ${response.status}: ${body}`.trim());
    }
  }
}
