import type { DocumentRecord } from "@signatories/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { firstName, renderEmail } from "../lib/mailer/shell.ts";
import { resolveSender } from "./sender.ts";
import { type ResolvedSite, siteForDocument } from "../sites/site.ts";

/**
 * `specs/behaviors/notifications.md` § Operator mail — the messages that go
 * to an operator rather than to a participant. They are never
 * preference-gated, write nothing to the record, are never sent to the
 * operator who caused them, and their delivery is recorded in the log and
 * nowhere else.
 *
 * They go straight to `fastify.mailer`, the same path `auth/routes.ts` uses
 * for `operator-magic-link`: the dispatcher builds every recipient's context
 * from a participation record (`context.ts`), and an operator has none — a
 * message of theirs parked in the dispatcher's failure bucket could never be
 * retried or cleared.
 */

export interface OperatorRecipient {
  email: string;
  name: string;
}

/**
 * The resolved site's own address (`specs/behaviors/sites.md`): an operator
 * message names the site the action happened on and links to its host,
 * falling back to this request's origin when the default site has no
 * `PUBLIC_URL` (local dev).
 */
function siteBaseUrl(request: FastifyRequest): string {
  if (request.site.baseUrl) return request.site.baseUrl.replace(/\/$/u, "");
  const proto = (request.headers["x-forwarded-proto"] as string | undefined) ?? request.protocol;
  const host = request.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

/** How the actor reads in a sentence: their name when the record has one, else the email that acted. */
function actorLabel(fastify: FastifyInstance, actorEmail: string): string {
  const actor = fastify.storage.readModel.getOperatorByEmail(actorEmail);
  return actor?.name || actorEmail;
}

interface SendOptions {
  eventKey: string;
  /**
   * The site the message speaks for. An access message belongs to the
   * **resolved** site (the host the action happened on); a message about a
   * document belongs to the **document's** site, which is the one every
   * link in it is built on (`specs/behaviors/sites.md` § Mail).
   */
  site: ResolvedSite;
  /** Set for a message about a document, so its own `sender_name`/`reply_to` win. */
  document?: DocumentRecord;
  to: OperatorRecipient;
  subject: string;
  body: string[];
  button: { label: string; url: string };
  smallPrint: string[];
}

/**
 * One send, best-effort: the commit that triggered it has already landed, so
 * a mailer that refuses must not turn an action that happened into a request
 * that failed. Logged either way — that log line is the whole record of an
 * operator message (§ Operator mail).
 */
async function send(fastify: FastifyInstance, opts: SendOptions): Promise<boolean> {
  const rendered = renderEmail({
    greeting: `Hi ${firstName(opts.to.name)},`,
    body: opts.body,
    button: opts.button,
    smallPrint: opts.smallPrint,
  });

  const sender = resolveSender(fastify, opts.document, opts.site);

  try {
    await fastify.mailer.send({
      to: { name: opts.to.name, email: opts.to.email },
      from: sender.from,
      replyTo: sender.replyTo,
      tag: sender.tag,
      subject: opts.subject,
      text: rendered.text,
      html: rendered.html,
    });
    fastify.siteObservations.recordSend(sender.tag, true);
    fastify.log.info({ event: opts.eventKey, operator: opts.to.email }, "operator mail: delivered");
    return true;
  } catch (err) {
    fastify.siteObservations.recordSend(sender.tag, false);
    fastify.log.warn(
      {
        event: opts.eventKey,
        operator: opts.to.email,
        error: err instanceof Error ? err.message : String(err),
      },
      "operator mail: delivery failed",
    );
    return false;
  }
}

/**
 * `operator-added` — an operator record was created. Names the instance and
 * who created the account, and gives the `/admin` address with the fact that
 * signing in is an emailed link rather than a password. No document, no token.
 */
export async function sendOperatorAdded(
  fastify: FastifyInstance,
  request: FastifyRequest,
  opts: { operator: OperatorRecipient; actorEmail: string },
): Promise<boolean> {
  if (opts.operator.email === opts.actorEmail) return false;

  const name = request.site.name;
  const base = siteBaseUrl(request);

  return send(fastify, {
    eventKey: "operator-added",
    site: request.site,
    to: opts.operator,
    subject: `You're an operator on ${name}`,
    body: [
      `${actorLabel(fastify, opts.actorEmail)} added you as an operator on ${name}, the service the team drafts and signs statements with.`,
      "You can sign in now; a document has to be shared with you before you can work on it.",
    ],
    button: { label: `Sign in to ${name}`, url: `${base}/admin` },
    smallPrint: [
      "There is no password: enter this address and the instance emails you a sign-in link.",
      "If you weren't expecting this, you can ignore this email.",
    ],
  });
}

/**
 * `operator-added-to-document` — an operator was added to a document. Names
 * the document, who added them, and the dashboard address. No participant data.
 */
export async function sendOperatorAddedToDocument(
  fastify: FastifyInstance,
  request: FastifyRequest,
  opts: {
    operator: OperatorRecipient;
    actorEmail: string;
    documentSlug: string;
    documentTitle: string;
  },
): Promise<boolean> {
  if (opts.operator.email === opts.actorEmail) return false;

  const name = request.site.name;
  const base = siteBaseUrl(request);

  return send(fastify, {
    eventKey: "operator-added-to-document",
    site: request.site,
    to: opts.operator,
    subject: `${opts.documentTitle} — you were added as an operator`,
    body: [
      `${actorLabel(fastify, opts.actorEmail)} added you as an operator on "${opts.documentTitle}" on ${name}.`,
      "You can now publish versions, invite people and read what comes back.",
    ],
    button: {
      label: "Open the dashboard",
      url: `${base}/admin/d/${encodeURIComponent(opts.documentSlug)}`,
    },
    smallPrint: [
      "There is no password: enter your address at the sign-in page and the instance emails you a link.",
    ],
  });
}

/**
 * `specs/behaviors/notifications.md` § Operator digest — one message to
 * every **active operator of the document** (not of its site: the site's
 * group is who *may* be given a document, not who is running this one).
 *
 * Takes no request: the digest runs on a timer, and a message about a
 * document belongs to the document's site whichever host — or none —
 * triggered it. Returns what the mailer accepted, because the caller only
 * records the message as sent when at least one was (§ "A sent count is a
 * delivery count").
 */
export async function sendToDocumentOperators(
  fastify: FastifyInstance,
  opts: {
    eventKey: string;
    document: DocumentRecord;
    subject: string;
    body: string[];
    buttonLabel?: string;
  },
): Promise<{ delivered: number; failed: number }> {
  const site = siteForDocument(fastify, opts.document);
  const base = site.baseUrl.replace(/\/$/u, "");
  const url = `${base}/admin/d/${encodeURIComponent(opts.document.slug)}`;

  let delivered = 0;
  let failed = 0;
  for (const email of opts.document.operators ?? []) {
    const operator = fastify.storage.readModel.getOperatorByEmail(email);
    if (!operator || !operator.active) continue;
    const ok = await send(fastify, {
      eventKey: opts.eventKey,
      site,
      document: opts.document,
      to: { email: operator.email, name: operator.name || operator.email },
      subject: opts.subject,
      body: opts.body,
      button: { label: opts.buttonLabel ?? "Open the dashboard", url },
      // No small print: the participant line ("this link is yours alone")
      // is about a personal link, and § Operator mail rules out a "you are
      // receiving this because" footer and any preference link.
      smallPrint: [],
    });
    if (ok) delivered += 1;
    else failed += 1;
  }

  return { delivered, failed };
}
