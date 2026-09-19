import type { FastifyRequest } from "fastify";

import { ApiError } from "../../errors.ts";
import type { Actor } from "../../storage/actor.ts";

export function adminActor(request: FastifyRequest): Actor {
  const principal = request.principal;
  if (!principal || principal.kind !== "admin") {
    throw new Error("admin route reached without a resolved admin principal");
  }
  return principal.actor;
}

export function notFoundDocument(slug: string): ApiError {
  return new ApiError("not_found", `No document '${slug}'.`);
}
