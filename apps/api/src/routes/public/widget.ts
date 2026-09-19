import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyPluginAsync } from "fastify";

import { PUBLIC_ROUTE } from "../../gateway/gateway.ts";
import { loadPublicDocument } from "./context.ts";

/**
 * Built by Vite from `apps/web/public/widget.js`, copied verbatim to
 * `apps/web/dist/widget.js` the same way `favicon.svg`/`icons.svg` are
 * (`routes/static.ts`'s `PUBLIC_ROOT_FILES`) — Vite copies everything under
 * `public/` to the build root unchanged. Same directory `routes/static.ts`
 * defaults to, one level further up since this module lives one directory
 * deeper (`routes/public/widget.ts` vs `routes/static.ts`).
 */
const WEB_DIST = new URL("../../../../web/dist", import.meta.url);

export interface WidgetRouteOptions {
  /** Test-only override for where the built SPA (and `widget.js`) lives; mirrors `routes/static.ts`'s `StaticRoutesOptions.root`. */
  root?: string | URL;
}

interface WidgetParams {
  slug: string;
}

/**
 * `specs/screens/public-and-embed.md`: "`GET /d/<slug>/widget.js` | a tiny
 * script ... | CORS `*`", and the same "All 404 ..." rule as every other
 * route in that table — the script's content is generic, but a caller
 * still can't distinguish a private document from an unknown one by
 * fetching this URL.
 */
const widgetRoute: FastifyPluginAsync<WidgetRouteOptions> = async (fastify, opts) => {
  const root = opts.root ?? WEB_DIST;
  const rootPath = typeof root === "string" ? root : fileURLToPath(root);
  const widgetPath = join(rootPath, "widget.js");

  fastify.get<{ Params: WidgetParams }>(
    "/widget.js",
    { config: PUBLIC_ROUTE },
    (request, reply) => {
      loadPublicDocument(fastify, request);

      if (!existsSync(widgetPath)) {
        return reply.code(404).send({ error: "not_found", message: "Not found.", details: {} });
      }
      const source = readFileSync(widgetPath, "utf8");

      reply.header("content-type", "application/javascript; charset=utf-8");
      reply.header("access-control-allow-origin", "*");
      reply.header("cache-control", "public, max-age=300");
      return reply.send(source);
    },
  );
};

export default widgetRoute;
