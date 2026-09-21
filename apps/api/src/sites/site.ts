import { DEFAULT_SITE_SLUG, type SiteRecord } from "@community-drafter/shared";
import type { FastifyInstance } from "fastify";

/**
 * `specs/behaviors/sites.md`. One deployment answers on many hostnames; a
 * **site** is one hostname and the identity carried on it. Every request
 * resolves to exactly one site before routing (`sites/plugin.ts`), and
 * everything that used to read `PUBLIC_URL` or `INSTANCE_NAME` reads a site
 * instead — with the one exception that matters more than the rule: a
 * personal or public **link is always minted on the document's site**,
 * never on the site the request arrived at.
 *
 * The **default site** is derived from the deployment's own configuration
 * rather than from a record, so an instance that has never created a site
 * behaves exactly as it did before and nothing needs migrating.
 */
export interface ResolvedSite {
  /** `default` for the derived site; a record's own slug otherwise. */
  slug: string;
  /**
   * The hostname this site answers on. Undefined only for the default site
   * of a deployment with no `PUBLIC_URL` (local dev and tests), where links
   * stay relative exactly as they did before sites existed.
   */
  hostname?: string;
  name: string;
  sender_name?: string;
  /** The verified `From` address, when this site has one (`specs/behaviors/sites.md` § Mail). */
  sender_email?: string;
  reply_to?: string;
  logo_url?: string;
  accent?: string;
  /** Web surfaces and links are built on this origin; `""` keeps links relative (dev/test). */
  baseUrl: string;
  isDefault: boolean;
}

/** The instance-wide fallback name, used when `INSTANCE_NAME` is unset. */
export const FALLBACK_INSTANCE_NAME = "Community Drafter";

export { DEFAULT_SITE_SLUG };

/** `https://host` for a site record; `PUBLIC_URL` (or `""`) for the default site. */
function baseUrlForHostname(hostname: string): string {
  return `https://${hostname}`;
}

/** The host of `PUBLIC_URL`, lowercased and without its port — the default site's hostname. */
export function hostnameFromPublicUrl(publicUrl: string | undefined): string | undefined {
  if (!publicUrl) return undefined;
  try {
    return new URL(publicUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * `specs/behaviors/sites.md` § The default site: not a record — every field
 * is read from the deployment's configuration. It owns every document whose
 * `site` is absent and answers for any host that matches no record.
 */
export function defaultSite(config: FastifyInstance["config"]): ResolvedSite {
  const publicUrl = config.PUBLIC_URL?.trim().replace(/\/+$/u, "") || "";
  return {
    slug: DEFAULT_SITE_SLUG,
    hostname: hostnameFromPublicUrl(publicUrl),
    name: config.INSTANCE_NAME || FALLBACK_INSTANCE_NAME,
    sender_email: config.INSTANCE_FROM_EMAIL,
    reply_to: config.INSTANCE_FROM_EMAIL,
    baseUrl: publicUrl,
    isDefault: true,
  };
}

export function siteFromRecord(record: SiteRecord): ResolvedSite {
  return {
    slug: record.slug,
    hostname: record.hostname,
    name: record.name,
    sender_name: record.sender_name,
    sender_email: record.sender_email,
    reply_to: record.reply_to,
    logo_url: record.logo_url,
    accent: record.accent,
    baseUrl: baseUrlForHostname(record.hostname),
    isDefault: false,
  };
}

/** `Host: letters.example.org:8443` → `letters.example.org`. */
export function normalizeHost(host: string | undefined): string {
  if (!host) return "";
  const withoutPort = host.trim().toLowerCase().replace(/:\d+$/u, "");
  // An IPv6 literal arrives bracketed (`[::1]:3001`); the brackets are not
  // part of any hostname a site record can carry, so they come off too.
  return withoutPort.replace(/^\[|\]$/gu, "");
}

/**
 * `specs/behaviors/sites.md` § Resolving a site from a request: lowercase
 * the host, drop the port, match `sites.hostname` exactly, and fall back to
 * the default site. No wildcards, no suffix matching, no path prefixes.
 */
export function resolveSiteForHost(
  fastify: FastifyInstance,
  host: string | undefined,
): ResolvedSite {
  const hostname = normalizeHost(host);
  if (hostname) {
    const record = fastify.storage.readModel.getSiteByHostname(hostname);
    if (record) return siteFromRecord(record);
  }
  return defaultSite(fastify.config);
}

/** The site named by a slug, or the default site for `undefined`/`default`/an unknown slug. */
export function siteBySlug(fastify: FastifyInstance, slug: string | undefined): ResolvedSite {
  if (!slug || slug === DEFAULT_SITE_SLUG) return defaultSite(fastify.config);
  const record = fastify.storage.readModel.getSite(slug);
  return record ? siteFromRecord(record) : defaultSite(fastify.config);
}

/**
 * The site a document belongs to — the one its links, its mail and its
 * canonical hostname come from, whichever host a request arrived on
 * (`specs/behaviors/sites.md` § The document's site is canonical).
 */
export function siteForDocument(
  fastify: FastifyInstance,
  document: { site?: string },
): ResolvedSite {
  return siteBySlug(fastify, document.site);
}

/**
 * `specs/behaviors/sites.md` § The default site: the default site's operator
 * group is "every active operator who belongs to no other site's group,
 * plus every superadmin". Derived on read, never written — which is what
 * lets the instance-wide directory become per-site with no migration.
 */
export function siteOperatorGroup(fastify: FastifyInstance, slug: string): string[] {
  const readModel = fastify.storage.readModel;
  if (slug !== DEFAULT_SITE_SLUG) {
    const record = readModel.getSite(slug);
    if (!record) return [];
    const emails = new Set(record.operators.map((email) => email.toLowerCase()));
    for (const operator of readModel.listOperators()) {
      if (operator.superadmin === true && operator.active) emails.add(operator.email.toLowerCase());
    }
    return [...emails];
  }

  const claimed = new Set<string>();
  for (const site of readModel.listSites()) {
    for (const email of site.operators) claimed.add(email.toLowerCase());
  }
  return readModel
    .listOperators()
    .filter(
      (operator) =>
        operator.active &&
        (operator.superadmin === true || !claimed.has(operator.email.toLowerCase())),
    )
    .map((operator) => operator.email.toLowerCase());
}

/** Whether an email is in a site's operator group (a superadmin is in every group). */
export function isSiteOperator(fastify: FastifyInstance, slug: string, email: string): boolean {
  const target = email.toLowerCase();
  return siteOperatorGroup(fastify, slug).includes(target);
}

/** The sites a caller belongs to, default site included, newest-irrelevant order. */
export function sitesForOperator(
  fastify: FastifyInstance,
  email: string,
  superadmin: boolean,
): ResolvedSite[] {
  const all = [
    defaultSite(fastify.config),
    ...fastify.storage.readModel.listSites().map(siteFromRecord),
  ];
  if (superadmin) return all;
  return all.filter((site) => isSiteOperator(fastify, site.slug, email));
}

/**
 * The site a document belongs to, as the slug every API shape prints:
 * `default` for a document that names none (`specs/api/admin.md`).
 */
export function documentSiteSlug(document: { site?: string }): string {
  return document.site ?? DEFAULT_SITE_SLUG;
}

/** The identity a participant or public surface carries (`specs/api/participant.md`). */
export function siteIdentity(site: ResolvedSite): {
  name: string;
  logo_url?: string;
  accent?: string;
} {
  return { name: site.name, logo_url: site.logo_url, accent: site.accent };
}
