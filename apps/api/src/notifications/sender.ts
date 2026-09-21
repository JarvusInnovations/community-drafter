import type { FastifyInstance } from "fastify";

import type { MailAddress } from "../lib/mailer/index.ts";
import type { ResolvedSite } from "../sites/site.ts";

/** The address used when nothing is configured at all (local dev, tests). */
const FALLBACK_FROM_EMAIL = "no-reply@community-drafter.local";

export interface ResolvedMailSender {
  from: MailAddress;
  replyTo?: string;
  /** `specs/behaviors/sites.md` § Mail: the site's slug, as the provider tag. */
  tag: string;
}

/**
 * `specs/behaviors/sites.md` § Mail — one place that decides every message's
 * From line, Reply-To and provider tag:
 *
 * - **From address**: the site's `sender_email` when it has one, otherwise
 *   the platform's own verified address. Never a substitution: a site that
 *   declared a sender the provider has not accepted yet produces delivery
 *   failures on the ordinary path (`notifications.md` § Sending), because
 *   an operator whose DNS is unfinished must see that rather than discover
 *   months later that their statement went out under someone else's name.
 * - **Display name**: the document's `sender_name`, else the site's, else
 *   the site's `name` — the document's voice wins, the site supplies the
 *   default a document may omit.
 * - **Reply-To**: the document's `reply_to`, else the site's.
 * - **Tag**: the site's slug, so per-site delivery statistics exist on one
 *   provider account.
 *
 * `document` is absent for the one message that is not about a document
 * (`operator-magic-link`), which belongs to the resolved site instead.
 */
export function resolveSender(
  fastify: FastifyInstance,
  document: { sender_name?: string; reply_to?: string } | undefined,
  site: ResolvedSite,
): ResolvedMailSender {
  const email = site.sender_email ?? fastify.config.INSTANCE_FROM_EMAIL ?? FALLBACK_FROM_EMAIL;
  const name = document?.sender_name ?? site.sender_name ?? site.name;
  return {
    from: { name, email },
    replyTo: document?.reply_to ?? site.reply_to,
    tag: site.slug,
  };
}
