import type { Judgement, Signature } from "@signatories/shared";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { createMailer, type Mailer } from "../lib/mailer/index.ts";
import type { Actor } from "../storage/actor.ts";
import { ClosingSoonScheduler } from "./closing-soon.ts";
import { NotificationDispatcher } from "./dispatcher.ts";
import { DigestScheduler } from "./digest.ts";
import { formatWhen } from "./format.ts";
import { sendFirstResponseNotice } from "./operator-digest.ts";
import {
  closedRecipients,
  scheduleChangedRecipients,
  signingOpenedRecipients,
} from "./triggers.ts";
import {
  closedTemplate,
  listingChangedTemplate,
  reviewReceiptTemplate,
  revocationConfirmationTemplate,
  type ScheduleChangeLine,
  scheduleChangedTemplate,
  signatureConfirmationTemplate,
  signingOpenedTemplate,
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
  /** Test-only override for the digest/closing-soon schedulers' poll interval. */
  schedulerIntervalMs?: number;
  /** Test-only: skip starting the digest/closing-soon timers (tests drive `tick()` directly). */
  disableSchedulers?: boolean;
  /** Test-only: inject a `Mailer` (e.g. `FakeMailer`) instead of building one from `MAILER`. */
  mailer?: Mailer;
}

/**
 * `plans/notifications.md`: the real dispatcher and mailers behind
 * `api-core`'s stub (`lib/notify.ts`'s synchronous `notified` marking is
 * kept — see that file's doc comment — this plugin is what actually
 * renders and sends). Wires the bus events that don't already carry their
 * own richer recipient computation (`sign`/`resign`/`revoke`/`decline`,
 * `signing-opened`/`closed`/`schedule-changed`) to the dispatcher.
 * Publish-triggered sends (`v<n>`, `disposition-v<n>`, `final-published`)
 * are called directly from `routes/admin/versions.ts`, which already has
 * the exact recipient lists `lib/notify.ts` computed; invitations and
 * reminders likewise, from `routes/admin/documents.ts` and
 * `routes/admin/invitations.ts`, because those responses must report what
 * the mailer accepted (`specs/behaviors/notifications.md` § Sending) and a
 * fire-and-forget bus event cannot tell them.
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
        const participation = fastify.storage.readModel.getParticipation(
          event.document,
          event.person,
        );
        const signature = participation?.record.signature;
        if (!signature) return;
        if (event.type === "sign") {
          // `specs/behaviors/notifications.md` § Operator digest: the first
          // signature is told to the document's operators the moment it
          // lands, once per document. A `resign` follows a revoke, which
          // follows a sign, so it is never the first.
          await sendFirstResponseNotice(fastify, event.document, "first_signature", event.person);
        }
        await dispatcher.deliver({
          document: event.document,
          eventKey: `signature-confirmation-${new Date().toISOString()}`,
          actor: DISPATCHER_ACTOR,
          targets: [
            {
              person: event.person,
              markNotified: true,
              render: (ctx) =>
                signatureConfirmationTemplate(ctx, {
                  capacity: signature.capacity,
                  conditional: signature.conditional === true,
                }),
            },
          ],
        });
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
      case "decline":
      case "submit": {
        await deliverReviewReceipt(fastify, dispatcher, event.document, event.person);
        if (event.type === "submit") await notifyFirstResponses(fastify, event);
        return;
      }
      case "signing-opened": {
        const recipients = signingOpenedRecipients(fastify, event.document);
        if (recipients.length === 0) return;
        await dispatcher.deliver({
          document: event.document,
          eventKey: "signing-opened",
          actor: DISPATCHER_ACTOR,
          targets: recipients.map((person) => ({
            person,
            markNotified: true,
            render: (ctx) => signingOpenedTemplate(ctx),
          })),
        });
        return;
      }
      case "closed": {
        const recipients = closedRecipients(fastify, event.document);
        if (recipients.length === 0) return;
        await dispatcher.deliver({
          document: event.document,
          eventKey: "closed",
          actor: DISPATCHER_ACTOR,
          targets: recipients.map((person) => ({
            person,
            markNotified: true,
            render: (ctx) => closedTemplate(ctx),
          })),
        });
        return;
      }
      case "schedule-changed": {
        const recipients = scheduleChangedRecipients(fastify, event.document);
        if (recipients.length === 0) return;
        // `specs/behaviors/notifications.md` § Content rules: the message
        // names each deadline that moved with its old and new time. The
        // absolute times are formatted here (one instance clock) so the
        // templates keep taking plain strings.
        const timezone = fastify.config.INSTANCE_TIMEZONE || "UTC";
        const changes: ScheduleChangeLine[] = [];
        for (const change of event.changes ?? []) {
          const to = formatWhen(change.to, timezone);
          if (!to) continue;
          const from = formatWhen(change.from, timezone);
          changes.push({
            label:
              change.deadline === "comments_close_at" ? "Comments close" : "Signatures are due",
            ...(from ? { from } : {}),
            to,
          });
        }
        await dispatcher.deliver({
          document: event.document,
          eventKey: "schedule-changed",
          actor: DISPATCHER_ACTOR,
          targets: recipients.map((person) => ({
            person,
            markNotified: true,
            render: (ctx) => scheduleChangedTemplate(ctx, { changes }),
          })),
        });
        return;
      }
      default:
        return;
    }
  });

  const digest = new DigestScheduler(fastify, opts.schedulerIntervalMs);
  const closingSoon = new ClosingSoonScheduler(fastify, opts.schedulerIntervalMs);
  if (!opts.disableSchedulers) {
    fastify.addHook("onReady", async () => {
      digest.start();
      closingSoon.start();
    });
    fastify.addHook("onClose", async () => {
      digest.stop();
      closingSoon.stop();
    });
  }
  fastify.decorate("digestScheduler", digest);
  fastify.decorate("closingSoonScheduler", closingSoon);
};

declare module "fastify" {
  interface FastifyInstance {
    digestScheduler: DigestScheduler;
    closingSoonScheduler: ClosingSoonScheduler;
  }
}

/**
 * `specs/behaviors/notifications.md` § Messages: `review-receipt-<ts>`, "a
 * review submitted" → the author. Fired for both the dedicated `decline`
 * route and `comment-mode`'s general `submit` endpoint (`sign` /
 * `sign_conditional` / `comment` / `decline`) — this reads the person's
 * current position (`ReadModel.getPosition`, already "the latest
 * `submitted` record") rather than threading a submission id through each
 * event, since a person may submit more than once and the position is
 * always the most recent one.
 */
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
 * `specs/behaviors/notifications.md` § Operator digest — comment mode is
 * the one path that can produce a document's first comment *and* its first
 * signature in a single commit (`specs/data-model.md` → `Signature`
 * trailer), so both notices are considered here.
 */
async function notifyFirstResponses(
  fastify: FastifyInstance,
  event: { document: string; person: string; submission: string; judgement: Judgement },
): Promise<void> {
  const submission = fastify.storage.readModel.getSubmission(event.document, event.submission);
  if ((submission?.record.comments?.length ?? 0) > 0) {
    await sendFirstResponseNotice(fastify, event.document, "first_comment", event.person);
  }

  const signature = fastify.storage.readModel.getParticipation(event.document, event.person)?.record
    .signature;
  if (signature && !signature.revoked) {
    await sendFirstResponseNotice(fastify, event.document, "first_signature", event.person);
  }
}

async function deliverReviewReceipt(
  fastify: FastifyInstance,
  dispatcher: NotificationDispatcher,
  document: string,
  person: string,
): Promise<void> {
  const position = fastify.storage.readModel.getPosition(document, person);
  if (!position) return;
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
        render: (ctx) =>
          reviewReceiptTemplate(ctx, { judgement: position.judgement, commentCount }),
      },
    ],
  });
}

export default fp(notificationsPlugin, "5.x");
