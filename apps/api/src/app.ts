import type { FastifyError, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import authPlugin from "./auth/plugin.ts";
import authRoutes from "./auth/routes.ts";
import { ApiError } from "./errors.ts";
import eventsPlugin from "./events/bus.ts";
import { PhaseObserver } from "./events/phase-observer.ts";
import gatewayPlugin from "./gateway/gateway.ts";
import commentTimingPlugin from "./lib/comment-timing.ts";
import idempotencyPlugin from "./lib/idempotency.ts";
import requestContextPlugin from "./lib/request-context.ts";
import notificationsPlugin, { type NotificationsPluginOptions } from "./notifications/plugin.ts";
import envPlugin from "./plugins/env.ts";
import renderingPlugin from "./rendering/cache.ts";
import adminRoutes from "./routes/admin/index.ts";
import healthRoutes from "./routes/health.ts";
import participantRoutes from "./routes/participant/index.ts";
import { publicApiRoutes, publicAssetRoutes } from "./routes/public/index.ts";
import staticRoutes, { type StaticRoutesOptions } from "./routes/static.ts";
import storagePlugin, { type StoragePluginOptions } from "./storage/plugin.ts";

export interface AppOptions {
  /** Test-only override for where/how the storage plugin opens its data repo. */
  storage?: StoragePluginOptions;
  /** Test-only override for the phase observer's poll interval. */
  phaseObserverIntervalMs?: number;
  /** Test-only: skip starting the phase observer's timer (tests drive `tick()` directly). */
  disablePhaseObserver?: boolean;
  /** Test-only overrides for the notifications plugin's schedulers (`notifications/plugin.ts`). */
  notifications?: NotificationsPluginOptions;
  /** Test-only override for where the built SPA lives (`routes/static.ts`). */
  static?: StaticRoutesOptions;
}

declare module "fastify" {
  interface FastifyInstance {
    phaseObserver: PhaseObserver;
  }
}

export const app: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  // 1. Register environment configuration FIRST
  await fastify.register(envPlugin);

  // Update log level from config
  fastify.log.level = fastify.config.LOG_LEVEL;

  // 2. Cross-cutting plugins the gateway and routes depend on.
  await fastify.register(requestContextPlugin);
  await fastify.register(eventsPlugin);
  await fastify.register(renderingPlugin);
  await fastify.register(idempotencyPlugin);
  await fastify.register(commentTimingPlugin);

  // 3. Storage: the data repo, read model, tracker, push daemon.
  await fastify.register(storagePlugin, opts.storage ?? {});

  // 3b. The mailer + dispatcher + digest/closing-soon schedulers
  //     (`notifications` plan). Needs storage + events + config; every
  //     route below (`versions.ts`'s publish handler in particular) calls
  //     `fastify.notifications`, so this must land before routes register.
  await fastify.register(notificationsPlugin, opts.notifications ?? {});

  // 3c. Operator auth (`operators-auth`): token mint/verify, device codes,
  //     used-magic-jti store. Must land before the gateway below — its
  //     operator-resolution branch reads `fastify.auth`.
  await fastify.register(authPlugin);

  // 4. The deny-by-default gateway. Must come after storage/config (token
  //    resolution and the admin bearer compare both read them) and after
  //    `authPlugin` (the cookie-session branch reads `fastify.auth`), and
  //    before every route registration below.
  await fastify.register(gatewayPlugin);

  // 5. The JSON error envelope (`specs/api/conventions.md` § Responses).
  fastify.setErrorHandler((err: FastifyError | ApiError, request, reply) => {
    if (err instanceof ApiError) {
      reply
        .status(err.status)
        .send({ error: err.code, message: err.message, details: err.details });
      return;
    }
    // Fastify's own schema-validation failures ("400 invalid_request
    // (schema)" per `specs/api/conventions.md`).
    if (err.validation) {
      reply.status(400).send({
        error: "invalid_request",
        message: err.message,
        details: { validation: err.validation },
      });
      return;
    }
    request.log.error(err);
    reply.status(err.statusCode ?? 500).send({
      error: "internal_error",
      message: "Something went wrong.",
      details: {},
    });
  });

  // 6. Routes.
  await fastify.register(healthRoutes, { prefix: "/_health" });
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(participantRoutes, { prefix: "/i/:token/api" });
  await fastify.register(adminRoutes, { prefix: "/admin/api" });
  // `public-and-embed`: the anonymous `/d/:slug/*` family
  // (`specs/api/conventions.md`). Two prefixes share the one `:slug`
  // segment — see `routes/public/index.ts`'s doc comment — and both must
  // register ahead of `staticRoutes`'s `/d/*` SPA-shell wildcard below.
  await fastify.register(publicApiRoutes, { prefix: "/d/:slug/api" });
  // `root` mirrors `staticRoutes`' override below — both serve out of the
  // same built `apps/web/dist` directory, so a test pointing one at a
  // fixture points the other at it too.
  await fastify.register(publicAssetRoutes, { prefix: "/d/:slug", root: opts.static?.root });

  // 6.5. `participant-sign-flow`: the built SPA (`apps/web/dist`), served
  // with an `/i/*` / `/d/*` / `/admin/*` fallback to `index.html`
  // (`specs/architecture.md` § API server). Registered after the JSON
  // routes above so this comment stays adjacent to them, though route
  // precedence itself comes from find-my-way ranking a parametric-then-
  // static route over a wildcard regardless of registration order.
  await fastify.register(staticRoutes, opts.static ?? {});

  // 7. The lifecycle clock's scheduler (`specs/behaviors/document-lifecycle.md`
  //    § Closing / signing-opened; `events/phase-observer.ts`).
  const phaseObserver = new PhaseObserver(fastify, opts.phaseObserverIntervalMs);
  fastify.decorate("phaseObserver", phaseObserver);
  if (!opts.disablePhaseObserver) {
    fastify.addHook("onReady", async () => {
      phaseObserver.start();
    });
    fastify.addHook("onClose", async () => {
      phaseObserver.stop();
    });
  }

  fastify.addHook("onReady", async () => {
    fastify.log.info("community-drafter API initialized");
    fastify.log.info(`Environment: ${fastify.config.NODE_ENV}`);
  });
};

export default fp(app, "5.x");
