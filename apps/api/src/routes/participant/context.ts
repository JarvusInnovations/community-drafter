import type { FastifyInstance, FastifyRequest } from "fastify";

import { ApiError, LINK_NOT_FOUND } from "../../errors.ts";
import type { ParticipantPrincipal } from "../../gateway/gateway.ts";
import { derivePhase, type Phase } from "../../phase/phase.ts";
import type { DocumentEntry, ParticipationEntry } from "../../storage/read-model.ts";

export function participantPrincipal(request: FastifyRequest): ParticipantPrincipal {
  const candidate = request.principal;
  if (!candidate || candidate.kind !== "participant") {
    // The gateway always resolves a principal before a `participant`-capability
    // handler runs (or throws first) — reaching a handler without one is a
    // wiring bug, not a request the client can cause.
    throw new Error("participant route reached without a resolved participant principal");
  }
  return candidate;
}

export interface ParticipantContext {
  document: DocumentEntry;
  participation: ParticipationEntry;
  phase: Phase;
}

/**
 * Common preamble for every `/i/:token/api/*` handler: resolve the document
 * and participation the gateway's token lookup named, and block reads of a
 * still-`draft` document — `specs/behaviors/document-lifecycle.md`:
 * "reachable only by admin credentials ... links resolve to a 'not yet
 * open' page until opening." Returning the *derived* phase here also
 * saves every route from recomputing it.
 */
export function loadParticipantContext(
  fastify: FastifyInstance,
  request: FastifyRequest,
): ParticipantContext {
  const { document: slug, person } = participantPrincipal(request);
  const document = fastify.storage.readModel.getDocument(slug);
  const participation = fastify.storage.readModel.getParticipation(slug, person);
  if (!document || !participation) throw LINK_NOT_FOUND;

  const phase = derivePhase(document.record, new Date());
  if (phase === "draft") {
    throw new ApiError("not_found", "This document hasn't opened yet.");
  }

  return { document, participation, phase };
}
