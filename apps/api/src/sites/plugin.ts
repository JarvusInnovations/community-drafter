import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { findPublicDocument } from "../lib/public-document.ts";
import { SiteObservations } from "./observations.ts";
import { normalizeHost, resolveSiteForHost, siteForDocument, type ResolvedSite } from "./site.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** What this process has actually seen about hostnames and senders (`sites/observations.ts`). */
    siteObservations: SiteObservations;
  }

  interface FastifyRequest {
    /**
     * `specs/behaviors/sites.md` § Resolving a site from a request: every
     * request resolves to exactly one site, before routing. Always set —
     * an unmatched host resolves to the default site, never to nothing.
     */
    site: ResolvedSite;
  }
}

/** The document a `/d/<slug>…` path names, through the public gate (an unreadable slug resolves to nothing). */
function publicDocumentForPath(fastify: FastifyInstance, path: string) {
  const match = /^\/d\/([^/]+)(?:\/|$)/u.exec(path);
  const raw = match?.[1];
  if (!raw) return null;
  let slug = raw;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    // A malformed escape is just not a slug; fall through to the raw value.
  }
  return findPublicDocument(fastify, slug);
}

/**
 * The document a `/i/<token>…` path names, held to the same validity rules
 * the gateway applies (`gateway.ts`'s `resolveParticipant`) — an unknown,
 * revoked or expired token resolves to nothing here too, so a wrong host
 * and a wrong token answer identically on every hostname.
 */
function participantDocumentForPath(fastify: FastifyInstance, path: string) {
  const match = /^\/i\/([^/]+)(?:\/|$)/u.exec(path);
  const token = match?.[1];
  if (!token) return null;

  const participation = fastify.storage.readModel.getParticipationByToken(token);
  if (!participation) return null;
  if (participation.record.link_revoked) return null;
  if (participation.record.expires_at && new Date(participation.record.expires_at) <= new Date()) {
    return null;
  }
  return fastify.storage.readModel.getDocument(participation.record.document) ?? null;
}

/**
 * `specs/behaviors/sites.md` § The document's site is canonical: a request
 * for `/d/<slug>…` or `/i/<token>…` whose resolved site is not the
 * document's site is answered with a **302** to the same path and query on
 * the document's hostname over https. Temporary, not permanent — an
 * operator can move a document to another site, and a cached permanent
 * redirect would outlive the fact.
 *
 * `/admin/…` and `/auth/…` never redirect: they are per-host by design.
 */
function canonicalRedirectTarget(fastify: FastifyInstance, request: FastifyRequest): string | null {
  const path = request.url.split("?")[0] ?? request.url;
  if (!path.startsWith("/d/") && !path.startsWith("/i/")) return null;

  const document = path.startsWith("/d/")
    ? publicDocumentForPath(fastify, path)
    : participantDocumentForPath(fastify, path);
  if (!document) return null;

  const site = siteForDocument(fastify, document.record);
  if (site.slug === request.site.slug) return null;
  // A site with no hostname is the default site of a deployment that has no
  // `PUBLIC_URL` (local dev, tests): there is no canonical address to send
  // anyone to, so the request is served where it arrived.
  if (!site.hostname) return null;

  return `https://${site.hostname}${request.url}`;
}

/**
 * Site resolution, registered ahead of the auth gateway so everything
 * downstream — routes, error paths, the SPA shell — reads `request.site`
 * (`specs/behaviors/sites.md`). The canonical-host redirect rides the same
 * hook: it runs before any handler, which is what makes a forged `Host`
 * harmless (a document still redirects to its own hostname before it
 * renders, and a token is still rejected unless its site matches).
 */
const sitesPlugin: FastifyPluginAsync = async (fastify) => {
  // A decorator declared with no value and assigned per request — Fastify
  // 5 refuses a shared reference default, and every request sets its own
  // in the hook below.
  fastify.decorateRequest("site");
  fastify.decorate("siteObservations", new SiteObservations());

  fastify.addHook("onRequest", async (request, reply) => {
    request.site = resolveSiteForHost(fastify, request.headers.host);
    // "Does this hostname route here?" is only ever answered by a request
    // arriving on it (`sites/observations.ts`).
    fastify.siteObservations.markHostSeen(normalizeHost(request.headers.host));

    const target = canonicalRedirectTarget(fastify, request);
    if (target) {
      reply.redirect(target, 302);
      return reply;
    }
  });
};

export default fp(sitesPlugin, "5.x");
