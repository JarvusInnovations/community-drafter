import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { buildPrefsView, forcedKeys } from "../../lib/prefs.ts";
import { assertPhase } from "../../phase/phase.ts";
import { loadParticipantContext } from "./context.ts";

interface PrefsPutBody {
  channel?: string;
  every_revision?: boolean;
  daily_digest?: boolean;
  phase_changes?: boolean;
  my_comments_addressed?: boolean;
  reminders?: boolean;
}

const OPTIONAL_KEYS = [
  "every_revision",
  "daily_digest",
  "phase_changes",
  "my_comments_addressed",
  "reminders",
] as const;

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
    const forced = new Set(forcedKeys(participation));
    const current = participation.record.notify ?? {};
    const body = request.body;
    const ignored: string[] = [];

    const next = { ...current };
    if (body.channel !== undefined) next.channel = body.channel;
    for (const key of OPTIONAL_KEYS) {
      const requested = body[key];
      if (requested === undefined) continue;
      if (forced.has(key) && requested === false) {
        ignored.push(key);
        continue;
      }
      next[key] = requested;
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
    const forced = new Set(forcedKeys(participation));
    const current = participation.record.notify ?? {};

    const next = { ...current };
    for (const key of OPTIONAL_KEYS) {
      if (forced.has(key)) continue;
      next[key] = false;
    }

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
