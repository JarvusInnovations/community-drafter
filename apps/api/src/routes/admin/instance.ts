import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { ADMIN_ROUTE } from "../../gateway/gateway.ts";
import { actorTrailerValue } from "../../storage/actor.ts";
import { initDataRepo } from "../../storage/init.ts";
import { adminActor } from "./context.ts";

const instanceRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/whoami", { config: ADMIN_ROUTE }, async (request) => {
    const actor = adminActor(request);
    return { actor: actorTrailerValue(actor), capability: "admin" };
  });

  fastify.post("/init-data-repo", { config: ADMIN_ROUTE }, async () => {
    try {
      const result = await initDataRepo({ dataDir: fastify.storage.dataDir });
      return result;
    } catch (err) {
      throw new ApiError(
        "validation_failed",
        err instanceof Error ? err.message : "init-data-repo failed.",
      );
    }
  });
};

export default instanceRoute;
