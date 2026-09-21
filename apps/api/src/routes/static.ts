import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsync } from "fastify";

import { PUBLIC_ROUTE } from "../gateway/gateway.ts";
import {
  injectPreviewTags,
  renderPreviewTags,
  resolveBaseUrl,
  resolvePreview,
} from "../lib/share-preview.ts";

/**
 * `specs/architecture.md` § API server: "Serves the built web app
 * (`@fastify/static`) with SPA fallback for `/i/*`, `/d/*`, `/admin/*`."
 * The built assets live at `apps/web/dist`, three directories up from this
 * file (`apps/api/src/routes/static.ts` → `apps/web/dist`) — a relationship
 * the Dockerfile preserves (both source checkout and image WORKDIR keep
 * `apps/api` and `apps/web` siblings), so the same relative path resolves
 * in dev and in the container.
 *
 * `serve: false` disables the plugin's own automatic route registration
 * entirely (both its `GET /*` wildcard mode and its per-file glob mode) —
 * either way those routes would carry no `config.capability`, and the
 * deny-by-default gateway (`gateway/gateway.ts`) denies any route that
 * doesn't declare one. We register every route ourselves below, each with
 * `config: PUBLIC_ROUTE`, and check existence with plain `fs` first rather
 * than lean on `reply.sendFile`'s own not-found path
 * (`reply.callNotFound()`): that re-enters Fastify's route-dispatch
 * machinery against the app's default not-found *route*, which itself
 * carries no `config.capability` and so gets denied (403) by the same
 * gateway hook instead of returning a plain 404.
 */
const WEB_DIST = new URL("../../../web/dist", import.meta.url);

/**
 * Files Vite copies from `apps/web/public/` to the dist root (not
 * `dist/assets/`). `og.png` is the generic instance card every share
 * preview points at (`specs/screens/public-and-embed.md` § Share Preview).
 */
const PUBLIC_ROOT_FILES = ["favicon.svg", "icons.svg", "og.png"];

/**
 * Route families whose paths are client-side routes inside the one SPA
 * shell. `/admin` (bare, no trailing segment) is included alongside
 * `/admin/*` — unlike `/i/*`/`/d/*`, which only ever appear with a token or
 * slug segment, `admin-dashboard`'s document list lives at exactly
 * `/admin`, and a `/admin/*` wildcard alone does not match that bare path
 * (it fell through to the gateway's default-deny 403 before this fix).
 */
// `/auth/device` is the device-approval *page* (`specs/screens/admin-dashboard.md`);
// the JSON endpoints under `/auth/device/*` are POSTs and keep precedence.
const SPA_SHELL_PREFIXES = ["/i/*", "/d/*", "/admin", "/admin/*", "/auth/device"];

/**
 * `specs/screens/public-and-embed.md`: `/d/<slug>/embed` and
 * `/d/<slug>/signatories` are "frameable by any origin"; every other HTML
 * response — every other `/d/*` page and all of `/i/*`/`/admin/*` — is not.
 * Matched against the path only (no query string), so `?foo=bar` on either
 * route doesn't change the outcome.
 */
const FRAMEABLE_PUBLIC_PATH = /^\/d\/[^/]+\/(embed|signatories)\/?$/u;

function isFrameablePublicPath(path: string): boolean {
  return FRAMEABLE_PUBLIC_PATH.test(path);
}

/**
 * `plans/public-and-embed.md` § "Frameability headers": `frame-ancestors *`
 * with no `X-Frame-Options` on the two embeddable public pages; `DENY` +
 * `frame-ancestors 'none'` on every other HTML response the SPA shell
 * serves, including every `/i/*` participant page (personal links are
 * never embeddable — `specs/behaviors/access-and-identity.md` § Public
 * links: "framing a personal link on a public page would leak a
 * credential").
 */
function setFrameHeaders(
  reply: { header: (name: string, value: string) => unknown },
  path: string,
): void {
  if (isFrameablePublicPath(path)) {
    reply.header("content-security-policy", "frame-ancestors *");
    return;
  }
  reply.header("content-security-policy", "frame-ancestors 'none'");
  reply.header("x-frame-options", "DENY");
}

function notFound(reply: { code: (n: number) => { send: (body: unknown) => unknown } }): unknown {
  return reply.code(404).send({ error: "not_found", message: "Not found.", details: {} });
}

export interface StaticRoutesOptions {
  /** Test-only override for where the built SPA lives; defaults to `apps/web/dist`. */
  root?: string | URL;
}

const staticRoutes: FastifyPluginAsync<StaticRoutesOptions> = async (fastify, opts) => {
  const root = opts.root ?? WEB_DIST;
  const rootPath = typeof root === "string" ? root : fileURLToPath(root);

  await fastify.register(fastifyStatic, { root, serve: false });

  /** `join`s under `rootPath`, refusing any result that escapes it (`..` traversal). */
  function safeFile(relativePath: string): string | null {
    const resolved = join(rootPath, relativePath);
    const rel = relative(rootPath, resolved);
    if (rel.startsWith("..")) return null;
    return existsSync(resolved) ? relativePath : null;
  }

  // Hashed build output (JS/CSS chunks). The API's JSON routes under
  // `/i/:token/api/*` etc. keep precedence over these wildcards because
  // find-my-way ranks a parametric-then-static route above a wildcard
  // regardless of registration order.
  fastify.get<{ Params: { "*": string } }>(
    "/assets/*",
    { config: PUBLIC_ROUTE },
    (request, reply) => {
      const file = safeFile(`assets/${request.params["*"]}`);
      if (!file) return notFound(reply);
      return reply.sendFile(file);
    },
  );

  for (const file of PUBLIC_ROOT_FILES) {
    fastify.get(`/${file}`, { config: PUBLIC_ROUTE }, (_request, reply) => {
      const found = safeFile(file);
      if (!found) return notFound(reply);
      return reply.sendFile(found);
    });
  }

  /**
   * The shell is read rather than streamed because
   * `specs/screens/public-and-embed.md` § Share Preview needs its head
   * rewritten per request. It is a few KB and the instance is one container
   * (`specs/architecture.md`), so it is cached until the file's mtime moves
   * — which keeps `bun --watch` and a rebuilt `dist` honest in development
   * without re-reading on every request in production.
   */
  let cachedShell: { mtimeMs: number; html: string } | null = null;
  function readShell(path: string): string {
    const { mtimeMs } = statSync(path);
    if (cachedShell?.mtimeMs !== mtimeMs) {
      cachedShell = { mtimeMs, html: readFileSync(path, "utf8") };
    }
    return cachedShell.html;
  }

  for (const prefix of [...SPA_SHELL_PREFIXES, "/"]) {
    fastify.get(prefix, { config: PUBLIC_ROUTE }, (request, reply) => {
      const found = safeFile("index.html");
      if (!found) return notFound(reply);

      const path = request.url.split("?")[0] ?? request.url;
      setFrameHeaders(reply, path);

      const preview = resolvePreview(fastify, request, resolveBaseUrl(request), path);
      const html = injectPreviewTags(readShell(join(rootPath, found)), renderPreviewTags(preview));
      return reply.type("text/html; charset=utf-8").send(html);
    });
  }

  /**
   * `specs/api/conventions.md`: a `GET` for a path that matches nothing at
   * all — `/login`, `/sign-in`, a mistyped personal link — is a 404, and a
   * request that accepts HTML is answered with the app's own "this isn't
   * available" page rather than a JSON error body (#60: the gateway's
   * default-deny used to turn these into a raw JSON 403). A client that
   * asked for JSON, and every non-`GET`, still gets the JSON 404, so an
   * API caller is never handed a page to parse.
   *
   * No `config.capability` here: `setNotFoundHandler` takes no route
   * config, and it needs none — the gateway hook lets an unmatched request
   * through precisely because there is no route to have declared one.
   */
  fastify.setNotFoundHandler((request, reply) => {
    const accept = request.headers.accept ?? "";
    const wantsHtml = request.method === "GET" && accept.includes("text/html");
    const found = wantsHtml ? safeFile("index.html") : null;
    if (!found) return notFound(reply);
    setFrameHeaders(reply, request.url.split("?")[0] ?? request.url);
    reply.code(404);
    return reply.sendFile(found);
  });
};

export default staticRoutes;
