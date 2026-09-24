import type { FastifyRequest } from "fastify";

import { notFoundDocument } from "../../errors.ts";
import type { Actor } from "../../storage/actor.ts";

export { notFoundDocument };

/** The resolved operator's email as an `Actor` — every admin-originated commit's `Actor` trailer. */
export function adminActor(request: FastifyRequest): Actor {
  const principal = request.principal;
  if (!principal || principal.kind !== "operator") {
    throw new Error("admin route reached without a resolved operator principal");
  }
  return { kind: "operator", email: principal.email };
}
