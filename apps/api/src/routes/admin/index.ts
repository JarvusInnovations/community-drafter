import type { FastifyPluginAsync } from "fastify";

import activityRoute from "./activity.ts";
import documentsRoute from "./documents.ts";
import instanceRoute from "./instance.ts";
import invitationsRoute from "./invitations.ts";
import adminNotificationsRoute from "./notifications.ts";
import operatorsRoute from "./operators.ts";
import adminSignaturesRoute from "./signatures.ts";
import sitesRoute from "./sites.ts";
import adminStatementPdfRoute from "./statement-pdf.ts";
import adminSubmissionsRoute from "./submissions.ts";
import adminVersionsRoute from "./versions.ts";
import viewAsRoute from "./view-as.ts";

/** `specs/api/admin.md`: everything under `/admin/api`. */
const adminRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(documentsRoute);
  await fastify.register(adminVersionsRoute);
  await fastify.register(adminStatementPdfRoute);
  await fastify.register(invitationsRoute);
  await fastify.register(adminSignaturesRoute);
  await fastify.register(adminSubmissionsRoute);
  await fastify.register(viewAsRoute);
  await fastify.register(activityRoute);
  await fastify.register(adminNotificationsRoute);
  await fastify.register(operatorsRoute);
  await fastify.register(sitesRoute);
  await fastify.register(instanceRoute);
};

export default adminRoutes;
