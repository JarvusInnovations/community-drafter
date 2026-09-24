import type { Signature } from "@signatories/shared";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { joinNames } from "../deliverable/copy.ts";
import { createMailer, type Mailer } from "../lib/mailer/index.ts";
import { derivePhase } from "../phase/phase.ts";
import type { Actor } from "../storage/actor.ts";
import { NotificationDispatcher } from "./dispatcher.ts";
import { OperatorDigestJob } from "./digest.ts";
import { formatDay, formatWhen } from "./format.ts";
import { sendFirstResponseNotice } from "./operator-digest.ts";
import {
  listingChangedTemplate,
  reviewReceiptTemplate,
  revocationConfirmationTemplate,
  type SignatureReceiptData,
  signatureConfirmationTemplate,
} from "./templates.ts";

const DISPATCHER_ACTOR: Actor = { kind: "system" };

declare module "fastify" {
  interface FastifyInstance {
    notifications: NotificationDispatcher;
    /**
     * The raw `Mailer` behind `fastify.notifications` — decorated
     * separately so a caller that isn't participation-shaped (the
     * `operator-magic-link` send: `specs/behaviors/notifications.md`: "not
     * a participation message: no `notified` mark, no preference link")
     * can send without going through the dispatcher's document/
     * participation/`notified` machinery.
     */
    mailer: Mailer;
  }
}

export interface NotificationsPluginOptions {
  /** Test-only: inject a `Mailer` (e.g. `FakeMailer`) instead of building one from `MAILER`. */
  mailer?: Mailer;
}

/**
 * The dispatcher and mailer, and the **receipts** — the only messages sent
 * without an operator asking (`specs/principles.md` § Operators speak;
 * state changes don't). Every other participant message is sent by the
 * route that ran the operator's command, because that response has to
 * report what the mailer accepted: invitations and reminders
 * (`routes/admin/invitations.ts`, `documents.ts`), `schedule-changed`,
 * `confirm-call` and `delivered` (`documents.ts`), `disposition-v<n>`
 * (`versions.ts`). Phase changes and publishes have no listener here on
 * purpose.
 */
const notificationsPlugin: FastifyPluginAsync<NotificationsPluginOptions> = async (
  fastify,
  opts,
) => {
  const mailer = opts.mailer ?? createMailer(fastify.config);
  const dispatcher = new NotificationDispatcher(fastify, mailer);
  fastify.decorate("notifications", dispatcher);
  fastify.decorate("mailer", mailer);

  fastify.events.on(async (event) => {
    switch (event.type) {
      case "sign":
      case "resign": {
        if (event.type === "sign") {
          // `specs/behaviors/notifications.md` § Operator digest: the first
          // signature is told to the document's operators the moment it
          // lands, once per document. A `resign` follows a revoke, which
          // follows a sign, so it is never the first.
          await sendFirstResponseNotice(fastify, event.document, "first_signature", event.person);
        }
        await deliverSignatureReceipt(fastify, dispatcher, event.document, event.person);
        return;
      }
      case "listing-changed": {
        const participation = fastify.storage.readModel.getParticipation(
          event.document,
          event.person,
        );
        const signature = participation?.record.signature;
        if (!signature || signature.revoked) return;
        await dispatcher.deliver({
          document: event.document,
          eventKey: `listing-changed-${new Date().toISOString()}`,
          actor: DISPATCHER_ACTOR,
          targets: [
            {
              person: event.person,
              markNotified: true,
              render: (ctx) =>
                listingChangedTemplate(ctx, {
                  listedAs: listedAs(signature),
                  listed: signature.listed !== false,
                  showsList:
                    (fastify.storage.readModel.getDocument(event.document)?.record
                      .show_signatories ?? "list") === "list",
                }),
            },
          ],
        });
        return;
      }
      case "revoke": {
        await dispatcher.deliver({
          document: event.document,
          eventKey: `revocation-confirmation-${new Date().toISOString()}`,
          actor: DISPATCHER_ACTOR,
          targets: [
            {
              person: event.person,
              markNotified: true,
              render: (ctx) => revocationConfirmationTemplate(ctx, { reason: event.reason }),
            },
          ],
        });
        return;
      }
      case "decline": {
        await deliverReviewReceipt(fastify, dispatcher, event.document, event.person);
        return;
      }
      case "submit": {
        // `specs/behaviors/notifications.md` § What each message says: a
        // signing submission sends the signing receipt (mentioning its
        // comments) and nothing else; `comment` and `decline` send a review
        // receipt that names what the author can still do.
        if (event.judgement === "sign" || event.judgement === "sign_conditional") {
          const signature = fastify.storage.readModel.getParticipation(event.document, event.person)
            ?.record.signature;
          if (signature && !signature.revoked) {
            await sendFirstResponseNotice(fastify, event.document, "first_signature", event.person);
          }
          const submission = fastify.storage.readModel.getSubmission(
            event.document,
            event.submission,
          );
          await deliverSignatureReceipt(
            fastify,
            dispatcher,
            event.document,
            event.person,
            submission?.record.comments?.length ?? 0,
          );
          return;
        }
        await deliverReviewReceipt(fastify, dispatcher, event.document, event.person);
        return;
      }
      default:
        return;
    }
  });

  // Run by the scheduler tick (`tick/plugin.ts`), never by a timer here.
  fastify.decorate("operatorDigest", new OperatorDigestJob(fastify));
};

declare module "fastify" {
  interface FastifyInstance {
    operatorDigest: OperatorDigestJob;
  }
}

/**
 * How a signature currently reads on the list
 * (`specs/behaviors/signatures.md` § Display), for the one message that
 * has to quote it back: official capacity leads with the organization,
 * personal capacity with the person and their descriptor.
 */
function listedAs(signature: Signature): string {
  const detail = signature.capacity === "official" ? signature.title : signature.descriptor;
  const named = detail ? `${signature.display_name}, ${detail}` : signature.display_name;
  return signature.capacity === "official" && signature.org ? `${signature.org} — ${named}` : named;
}

/**
 * `specs/behaviors/signatures.md` § Display: the listing status is told to
 * the signer only where a signatory list exists at all. With
 * `show_signatories` of `count` or `none` there is nothing to be on or off,
 * so the confirmation says nothing rather than reassuring a signer about a
 * list no reader will ever see.
 */
function listingStatus(
  fastify: FastifyInstance,
  slug: string,
  listed: boolean,
): boolean | undefined {
  const document = fastify.storage.readModel.getDocument(slug);
  const show = document?.record.show_signatories ?? "list";
  return show === "list" ? listed : undefined;
}

/** "the State Board of Education" — `addressed_to` joined, or "its recipients". */
export function deliveredTo(addressedTo: readonly string[] | undefined): string {
  return addressedTo && addressedTo.length > 0 ? joinNames([...addressedTo]) : "its recipients";
}

/**
 * `specs/behaviors/notifications.md` → `signature-confirmation-<ts>`: the
 * receipt names the capacity and the listing, then "What happens next" —
 * the confirm-call and delivery promises until delivery, the delivery
 * itself after, and the change-or-remove deadline.
 */
async function deliverSignatureReceipt(
  fastify: FastifyInstance,
  dispatcher: NotificationDispatcher,
  document: string,
  person: string,
  commentCount?: number,
): Promise<void> {
  const participation = fastify.storage.readModel.getParticipation(document, person);
  const signature = participation?.record.signature;
  const documentEntry = fastify.storage.readModel.getDocument(document);
  if (!signature || signature.revoked || !documentEntry) return;
  const timezone = fastify.config.INSTANCE_TIMEZONE || "UTC";
  const record = documentEntry.record;
  const data: SignatureReceiptData = {
    capacity: signature.capacity,
    conditional: signature.conditional === true,
    listed: listingStatus(fastify, document, signature.listed !== false),
    deliveredTo: deliveredTo(record.addressed_to),
    deliveredOn: formatDay(record.delivered_at, timezone),
    removeBy: formatWhen(record.signing_closes_at, timezone),
    commentCount,
  };
  await dispatcher.deliver({
    document,
    eventKey: `signature-confirmation-${new Date().toISOString()}`,
    actor: DISPATCHER_ACTOR,
    targets: [
      {
        person,
        markNotified: true,
        render: (ctx) => signatureConfirmationTemplate(ctx, data),
      },
    ],
  });
}

/**
 * `specs/behaviors/notifications.md` → `review-receipt-<ts>`: sent only when
 * it can name an action. For `comment`, "you can add more comments until
 * <comments close>", and not at all once comments have closed; for
 * `decline`, "you can still sign until <signing closes>", and not at all
 * once signing has closed. The position read is the person's latest
 * submitted submission, which is the one this event is about.
 */
async function deliverReviewReceipt(
  fastify: FastifyInstance,
  dispatcher: NotificationDispatcher,
  document: string,
  person: string,
): Promise<void> {
  const position = fastify.storage.readModel.getPosition(document, person);
  const documentEntry = fastify.storage.readModel.getDocument(document);
  if (!position || !documentEntry) return;
  const judgement = position.judgement;
  if (judgement !== "comment" && judgement !== "decline") return;

  const phase = derivePhase(documentEntry.record, new Date());
  const timezone = fastify.config.INSTANCE_TIMEZONE || "UTC";
  const until =
    judgement === "comment"
      ? phase === "commenting"
        ? formatWhen(documentEntry.record.comments_close_at, timezone)
        : undefined
      : phase === "commenting" || phase === "signing"
        ? formatWhen(documentEntry.record.signing_closes_at, timezone)
        : undefined;
  if (!until) return;

  const submission = fastify.storage.readModel.getSubmission(document, position.submissionId);
  const commentCount = submission?.record.comments?.length ?? 0;

  await dispatcher.deliver({
    document,
    eventKey: `review-receipt-${new Date().toISOString()}`,
    actor: DISPATCHER_ACTOR,
    targets: [
      {
        person,
        markNotified: true,
        render: (ctx) => reviewReceiptTemplate(ctx, { judgement, commentCount, until }),
      },
    ],
  });
}

export default fp(notificationsPlugin, "5.x");
