import type { FastifyInstance } from "fastify";

import type { Actor } from "../storage/actor.ts";
import type { ParticipationEntry } from "../storage/read-model.ts";

type NotifyPrefKey =
  | "every_revision"
  | "daily_digest"
  | "phase_changes"
  | "my_comments_addressed"
  | "reminders";

/** `specs/behaviors/notifications.md` § Defaults. */
const DEFAULT_ON: Record<NotifyPrefKey, boolean> = {
  every_revision: false,
  daily_digest: false,
  phase_changes: true,
  my_comments_addressed: true,
  reminders: true,
};

export function prefOn(entry: ParticipationEntry, key: NotifyPrefKey): boolean {
  const value = entry.record.notify?.[key];
  return value ?? DEFAULT_ON[key];
}

/** `specs/behaviors/signatures.md` § Display: current signatory. */
export function isCurrentSigner(entry: ParticipationEntry): boolean {
  const signature = entry.record.signature;
  return Boolean(signature) && signature?.revoked !== true && signature?.display_approved === true;
}

export interface PublishNotifyCounts {
  every_revision: number;
  dispositions: number;
  signers: number;
}

/**
 * `specs/api/admin.md` § Versions → `POST .../versions` response:
 * `{ notified: { every_revision, dispositions, signers } }`. Computes
 * recipients from live preferences + `notified` idempotency and marks them
 * in **one** follow-up `Action: send` commit
 * (`specs/behaviors/notifications.md`: "recorded in one commit ... never
 * one commit per recipient"). Rendering and actually delivering the
 * message is the `notifications` plan's job — this plan's contract is the
 * counts and the idempotency marks they must be backed by, so a later
 * `retry` or digest run doesn't double-send.
 */
export async function dispatchPublishNotifications(opts: {
  fastify: FastifyInstance;
  document: string;
  version: number;
  final: boolean;
  dispositionedPersons: readonly string[];
  actor: Actor;
  requestId: string | undefined;
}): Promise<PublishNotifyCounts> {
  const { fastify, document, version, final, dispositionedPersons, actor, requestId } = opts;
  const participations = fastify.storage.readModel.listParticipationsForDocument(document);

  const versionKey = `v${version}`;
  const dispositionKey = `disposition-${versionKey}`;
  const dispositionedSet = new Set(dispositionedPersons);
  const now = new Date().toISOString();

  const marks = new Map<string, Record<string, string>>();
  let everyRevision = 0;
  let dispositions = 0;
  let signers = 0;

  for (const entry of participations) {
    if (entry.record.link_revoked) continue;
    const person = entry.record.person;
    const patch: Record<string, string> = {};

    if (prefOn(entry, "every_revision") && entry.record.notified?.[versionKey] === undefined) {
      patch[versionKey] = now;
      everyRevision += 1;
    }
    if (
      dispositionedSet.has(person) &&
      prefOn(entry, "my_comments_addressed") &&
      entry.record.notified?.[dispositionKey] === undefined
    ) {
      patch[dispositionKey] = now;
      dispositions += 1;
    }
    if (
      final &&
      isCurrentSigner(entry) &&
      entry.record.notified?.["final-published"] === undefined
    ) {
      patch["final-published"] = now;
      signers += 1;
    }

    if (Object.keys(patch).length > 0) marks.set(person, patch);
  }

  if (marks.size > 0) {
    await fastify.storage.commit(
      "send",
      {
        actor,
        subject: `send: v${version} notifications for ${document} (${marks.size} recipients)`,
        document,
        version,
        requestId,
      },
      async (tx) => {
        for (const [person, patch] of marks) {
          const current = await tx.participations.queryFirst({ document, person });
          if (!current) continue;
          await tx.participations.patch(
            { document, person },
            { notified: { ...current.notified, ...patch } },
          );
        }
      },
    );
  }

  return { every_revision: everyRevision, dispositions, signers };
}
