import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { NOTIFY_PREF_KEYS } from "../../lib/notify.ts";
import { buildPrefsView } from "../../lib/prefs.ts";
import { assertPhase } from "../../phase/phase.ts";
import { loadParticipantContext } from "./context.ts";

type PrefsPutBody = Record<string, unknown>;

/**
 * `specs/api/participant.md` § prefs: `PUT` accepts only `channel` and the
 * two preferences; any other key (including the retired `every_revision`,
 * `daily_digest` and `phase_changes`) is ignored and named in `ignored`.
 */
const ACCEPTED_KEYS = new Set<string>(["channel", ...NOTIFY_PREF_KEYS]);

function emailFor(fastify: FastifyInstance, document: string, person: string): string | undefined {
  // `specs/behaviors/sites.md` § People are per site: the person is resolved
  // through the document's site, never by id alone.
  return fastify.storage.readModel.getPersonOn(document, person)?.email;
}

const prefsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/prefs", { config: PARTICIPANT_ROUTE }, async (request) => {
    const { document, participation } = loadParticipantContext(fastify, request);
    return buildPrefsView(
      participation,
      emailFor(fastify, document.record.slug, participation.record.person),
    );
  });

  fastify.put<{ Body: PrefsPutBody }>("/prefs", { config: PARTICIPANT_ROUTE }, async (request) => {
    const { document, participation } = loadParticipantContext(fastify, request);
    assertPhase(document.record, new Date(), "change_prefs");

    const slug = document.record.slug;
    const person = participation.record.person;
    const current = participation.record.notify ?? {};
    const body = request.body ?? {};
    const ignored = Object.keys(body).filter((key) => !ACCEPTED_KEYS.has(key));

    const next = { ...current };
    if (typeof body.channel === "string") next.channel = body.channel;
    for (const key of NOTIFY_PREF_KEYS) {
      const requested = body[key];
      if (typeof requested === "boolean") next[key] = requested;
    }

    await fastify.storage.commit(
      "prefs",
      {
        actor: { kind: "participant" },
        subject: `prefs: ${person} on ${slug}`,
        document: slug,
        person,
        requestId: request.requestId,
      },
      async (tx) => {
        await tx.participations.patch({ document: slug, person }, { notify: next });
      },
    );

    const updated = fastify.storage.readModel.getParticipation(slug, person);
    return { ...buildPrefsView(updated!, emailFor(fastify, slug, person)), ignored };
  });

  fastify.post("/prefs/stop-optional", { config: PARTICIPANT_ROUTE }, async (request) => {
    const { document, participation } = loadParticipantContext(fastify, request);
    assertPhase(document.record, new Date(), "change_prefs");

    const slug = document.record.slug;
    const person = participation.record.person;
    const current = participation.record.notify ?? {};

    const next = { ...current };
    for (const key of NOTIFY_PREF_KEYS) next[key] = false;

    await fastify.storage.commit(
      "prefs",
      {
        actor: { kind: "participant" },
        subject: `prefs: ${person} on ${slug} (stop optional messages)`,
        document: slug,
        person,
        requestId: request.requestId,
      },
      async (tx) => {
        await tx.participations.patch({ document: slug, person }, { notify: next });
      },
    );

    const updated = fastify.storage.readModel.getParticipation(slug, person);
    return buildPrefsView(updated!, emailFor(fastify, slug, person));
  });
};

export default prefsRoute;
