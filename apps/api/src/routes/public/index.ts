import type { FastifyPluginAsync } from "fastify";

import bundleRoute from "./bundle.ts";
import compareRoute from "./compare.ts";
import signatoriesRoute from "./signatories.ts";
import versionsRoute from "./versions.ts";
import widgetRoute, { type WidgetRouteOptions } from "./widget.ts";

/**
 * `specs/api/conventions.md`: "`/d/:slug/*` | public pages, embeds, JSON |
 * none (enumerated anonymous)." Two prefixes share this one slug segment
 * (`app.ts`): the JSON bundle family lives under `/d/:slug/api/*` (allowed
 * by that same convention doc — "the JSON bundle routes may live under
 * `/d/:slug/api/*`"), while `signatories.json` and `widget.js` are
 * top-level under `/d/:slug/*` per `specs/screens/public-and-embed.md`'s
 * route table. Both groups must register ahead of `routes/static.ts`'s
 * `/d/*` SPA fallback.
 */
export const publicApiRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(bundleRoute);
  await fastify.register(versionsRoute);
  await fastify.register(compareRoute);
};

export const publicAssetRoutes: FastifyPluginAsync<WidgetRouteOptions> = async (fastify, opts) => {
  await fastify.register(signatoriesRoute);
  // Forward only `root`, not the whole `opts` object — it still carries the
  // `prefix` Fastify passed in for *this* registration, and re-passing that
  // to a nested `register()` call would apply `/d/:slug` a second time.
  await fastify.register(widgetRoute, { root: opts.root });
};
