import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { createMailer, type Mailer } from "../lib/mailer/index.ts";
import type { Actor } from "../storage/actor.ts";
import { ClosingSoonScheduler } from "./closing-soon.ts";
import { NotificationDispatcher } from "./dispatcher.ts";
import { DigestScheduler } from "./digest.ts";
import {
  closedRecipients,
  scheduleChangedRecipients,
  signingOpenedRecipients,
} from "./triggers.ts";
import {
  closedTemplate,
  invitationTemplate,
  reminderTemplate,
  reviewReceiptTemplate,
  revocationConfirmationTemplate,
  scheduleChangedTemplate,
  signatureConfirmationTemplate,
  signingOpenedTemplate,
} from "./templates.ts";

const DISPATCHER_ACTOR: Actor = { kind: "cli", label: "notifications-dispatcher" };

declare module "fastify" {
  interface FastifyInstance {
    notifications: NotificationDispatcher;
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
 * `invite`/`send`/`remind`, `signing-opened`/`closed`/`schedule-changed`) to
 * the dispatcher; publish-triggered sends (`v<n>`, `disposition-v<n>`,
 * `final-published`) are called directly from
 * `routes/admin/versions.ts`, which already has the exact recipient lists
 * `lib/notify.ts` computed.
 */
const notificationsPlugin: FastifyPluginAsync<NotificationsPluginOptions> = async (
  fastify,
  opts,
) => {
  const mailer = opts.mailer ?? createMailer(fastify.config);
  const dispatcher = new NotificationDispatcher(fastify, mailer);
  fastify.decorate("notifications", dispatcher);

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
      case "invite":
      case "send": {
        if (event.people.length === 0) return;
        await dispatcher.deliver({
          document: event.document,
          eventKey: "invitation",
          actor: DISPATCHER_ACTOR,
          targets: event.people.map((person) => ({
            person,
            markNotified: false,
            render: (ctx) => invitationTemplate(ctx),
          })),
        });
        return;
      }
      case "remind": {
        if (event.people.length === 0) return;
        await dispatcher.deliver({
          document: event.document,
          eventKey: "reminder",
          actor: DISPATCHER_ACTOR,
          targets: event.people.map((person) => {
            const participation = fastify.storage.readModel.getParticipation(
              event.document,
              person,
            );
            const n =
              typeof participation?.record.notified?.reminder === "number"
                ? participation.record.notified.reminder
                : 1;
            return {
              person,
              markNotified: false,
              render: (ctx) => reminderTemplate(ctx, { n }),
            };
          }),
        });
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
        await dispatcher.deliver({
          document: event.document,
          eventKey: "schedule-changed",
          actor: DISPATCHER_ACTOR,
          targets: recipients.map((person) => ({
            person,
            markNotified: true,
            render: (ctx) => scheduleChangedTemplate(ctx),
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
 * review submitted" → the author. `comment-mode` (still `planned`) hasn't
 * built the general submit endpoint yet, so today the only submitted
 * submissions are `decline`s — this reads the person's current position
 * (`ReadModel.getPosition`, already "the latest `submitted` record") rather
 * than threading a submission id through the `decline` event.
 */
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
