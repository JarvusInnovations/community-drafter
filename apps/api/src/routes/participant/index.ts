import type { FastifyPluginAsync } from "fastify";

import bundleRoute from "./bundle.ts";
import compareRoute from "./compare.ts";
import declineRoute from "./decline.ts";
import draftRoute from "./draft.ts";
import prefsRoute from "./prefs.ts";
import signatureRoute from "./signature.ts";
import participantStatementPdfRoute from "./statement-pdf.ts";
import submitRoute from "./submit.ts";
import versionsRoute from "./versions.ts";

/** `specs/api/participant.md`: everything under `/i/:token/api`. */
const participantRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(bundleRoute);
  await fastify.register(signatureRoute);
  await fastify.register(participantStatementPdfRoute);
  await fastify.register(declineRoute);
  await fastify.register(draftRoute);
  await fastify.register(submitRoute);
  await fastify.register(versionsRoute);
  await fastify.register(compareRoute);
  await fastify.register(prefsRoute);
};

export default participantRoutes;
