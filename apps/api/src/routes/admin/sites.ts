import { DEFAULT_SITE_SLUG, HOSTNAME_PATTERN, type SiteRecord } from "@signatories/shared";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

import { ApiError } from "../../errors.ts";
import { OPERATOR_ROUTE } from "../../gateway/gateway.ts";
import { resolveSender } from "../../notifications/sender.ts";
import { dnsRecordsForSite } from "../../sites/dns.ts";
import {
  defaultSite,
  documentSiteSlug,
  isSiteOperator,
  siteBySlug,
  siteFromRecord,
  siteOperatorGroup,
  type ResolvedSite,
} from "../../sites/site.ts";
import { adminActor } from "./context.ts";

interface SlugParams {
  slug: string;
}

interface SlugEmailParams extends SlugParams {
  email: string;
}

interface CreateSiteBody {
  slug: string;
  hostname: string;
  name: string;
  sender_name?: string;
  sender_email?: string;
  reply_to: string;
  logo_url?: string;
  accent?: string;
}

interface PatchSiteBody {
  name?: string;
  sender_name?: string;
  sender_email?: string;
  reply_to?: string;
  logo_url?: string;
  accent?: string;
}

interface AddSiteOperatorBody {
  email: string;
  /**
   * Only read when the email has no operator record yet — the group add
   * creates one (`specs/api/admin.md` § Sites), and a record needs a name.
   * Defaults to the address itself.
   */
  name?: string;
}

/** `Name <address>` — the From line mail from this site will actually use. */
function fromLine(fastify: FastifyInstance, site: ResolvedSite): string {
  const sender = resolveSender(fastify, undefined, site);
  return `${sender.from.name} <${sender.from.email}>`;
}

function siteView(fastify: FastifyInstance, site: ResolvedSite) {
  const documents = fastify.storage.readModel
    .listDocuments()
    .filter((entry) => documentSiteSlug(entry.record) === site.slug).length;

  return {
    slug: site.slug,
    hostname: site.hostname,
    name: site.name,
    sender_name: site.sender_name,
    sender_email: site.sender_email,
    reply_to: site.reply_to,
    logo_url: site.logo_url,
    accent: site.accent,
    operators: siteOperatorGroup(fastify, site.slug),
    documents,
    // `specs/api/admin.md` § Sites: observations, never promises — `null`
    // is "not observed yet" (`sites/observations.ts`).
    from_line: fromLine(fastify, site),
    hostname_verified: fastify.siteObservations.hostSeen(site.hostname),
    sender_verified: fastify.siteObservations.senderAccepted(site.slug),
    /** What the customer still has to add; a record routes nothing on its own. */
    dns: site.hostname
      ? dnsRecordsForSite({ hostname: site.hostname, sender_email: site.sender_email })
      : [],
    default: site.isDefault,
  };
}

/** The 404 an unknown *or* unreachable site gets, so one cannot be told from the other. */
function noSite(slug: string): ApiError {
  return new ApiError("not_found", `No site '${slug}'.`);
}

const sitesRoute: FastifyPluginAsync = async (fastify) => {
  function caller(request: FastifyRequest): { email: string; superadmin: boolean } {
    const principal = request.principal;
    if (!principal || principal.kind !== "operator") {
      throw new ApiError("unauthenticated", "An operator credential is required.");
    }
    return { email: principal.email, superadmin: principal.superadmin };
  }

  /** `specs/behaviors/sites.md`: creating a site, changing its identity and deleting it are superadmin actions. */
  function requireSuperadmin(request: FastifyRequest): void {
    if (!caller(request).superadmin) {
      throw new ApiError("forbidden", "Only a superadmin can create, change or delete a site.");
    }
  }

  /** A site the caller may see at all; anything else is the same 404 as an unknown slug. */
  function visibleSite(request: FastifyRequest, slug: string): ResolvedSite {
    const { email, superadmin } = caller(request);
    if (slug === DEFAULT_SITE_SLUG) {
      const site = defaultSite(fastify.config);
      if (!superadmin && !isSiteOperator(fastify, DEFAULT_SITE_SLUG, email)) throw noSite(slug);
      return site;
    }
    const record = fastify.storage.readModel.getSite(slug);
    if (!record) throw noSite(slug);
    if (!superadmin && !isSiteOperator(fastify, slug, email)) throw noSite(slug);
    return siteFromRecord(record);
  }

  /** A writable site: the default site is derived from configuration and is not a record. */
  function writableSite(slug: string): SiteRecord {
    if (slug === DEFAULT_SITE_SLUG) {
      throw new ApiError(
        "validation_failed",
        "The default site is derived from the deployment's configuration and cannot be changed through the API.",
        { field: "slug" },
      );
    }
    const record = fastify.storage.readModel.getSite(slug);
    if (!record) throw noSite(slug);
    return record;
  }

  fastify.get("/sites", { config: OPERATOR_ROUTE }, async (request) => {
    const { email, superadmin } = caller(request);
    const sites = [
      defaultSite(fastify.config),
      ...fastify.storage.readModel.listSites().map(siteFromRecord),
    ];
    return sites
      .filter((site) => superadmin || isSiteOperator(fastify, site.slug, email))
      .map((site) => siteView(fastify, site));
  });

  fastify.get<{ Params: SlugParams }>(
    "/sites/:slug",
    { config: OPERATOR_ROUTE },
    async (request) => {
      return siteView(fastify, visibleSite(request, request.params.slug));
    },
  );

  fastify.post<{ Body: CreateSiteBody }>(
    "/sites",
    {
      config: OPERATOR_ROUTE,
      schema: {
        body: {
          type: "object",
          required: ["slug", "hostname", "name", "reply_to"],
          properties: {
            slug: { type: "string" },
            hostname: { type: "string" },
            name: { type: "string", minLength: 1 },
            sender_name: { type: "string" },
            sender_email: { type: "string" },
            reply_to: { type: "string" },
            logo_url: { type: "string" },
            accent: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      requireSuperadmin(request);
      const body = request.body;
      const slug = body.slug.trim().toLowerCase();
      const hostname = body.hostname.trim().toLowerCase();

      if (slug === DEFAULT_SITE_SLUG) {
        throw new ApiError(
          "validation_failed",
          "'default' is reserved for the deployment's own site.",
          { field: "slug" },
        );
      }
      if (fastify.storage.readModel.getSite(slug)) {
        throw new ApiError("already_exists", `A site '${slug}' already exists.`, { field: "slug" });
      }
      if (!HOSTNAME_PATTERN.test(hostname)) {
        throw new ApiError(
          "validation_failed",
          "hostname must be a bare DNS host name: no scheme, no port, no path.",
          { field: "hostname" },
        );
      }
      const claimed = fastify.storage.readModel.getSiteByHostname(hostname);
      const ownHostname = defaultSite(fastify.config).hostname;
      if (claimed || (ownHostname && ownHostname === hostname)) {
        throw new ApiError(
          "hostname_taken",
          `'${hostname}' is already claimed by this deployment.`,
          {
            field: "hostname",
            site: claimed?.slug ?? DEFAULT_SITE_SLUG,
          },
        );
      }

      const actor = adminActor(request);
      const callerEmail = actor.kind === "operator" ? actor.email : "";
      const result = await fastify.storage.commit(
        "site-create",
        {
          actor,
          subject: `site-create: ${slug} (${hostname})`,
          site: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.sites.upsert({
            slug,
            hostname,
            name: body.name,
            sender_name: body.sender_name,
            sender_email: body.sender_email,
            reply_to: body.reply_to,
            logo_url: body.logo_url,
            accent: body.accent,
            operators: [callerEmail],
            created_by: callerEmail,
          });
        },
      );

      reply.status(201);
      return {
        ...siteView(fastify, siteBySlug(fastify, slug)),
        commit: result.commitHash,
      };
    },
  );

  fastify.patch<{ Params: SlugParams; Body: PatchSiteBody }>(
    "/sites/:slug",
    { config: OPERATOR_ROUTE },
    async (request) => {
      requireSuperadmin(request);
      const record = writableSite(request.params.slug);

      // `specs/api/admin.md`: `hostname` is not patchable — a site has
      // exactly one hostname, and a new one is a new site, because DNS, a
      // certificate and every link already sent are attached to the old one.
      const allowedKeys = [
        "name",
        "sender_name",
        "sender_email",
        "reply_to",
        "logo_url",
        "accent",
      ] as const;
      const patch: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (request.body[key] !== undefined) patch[key] = request.body[key];
      }
      if (Object.keys(patch).length === 0) {
        throw new ApiError("validation_failed", "Nothing to update.");
      }

      const result = await fastify.storage.commit(
        "site-update",
        {
          actor: adminActor(request),
          subject: `site-update: ${record.slug}`,
          site: record.slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.sites.patch({ slug: record.slug }, patch);
        },
      );

      return {
        ...siteView(fastify, siteBySlug(fastify, record.slug)),
        commit: result.commitHash,
      };
    },
  );

  fastify.delete<{ Params: SlugParams }>(
    "/sites/:slug",
    { config: OPERATOR_ROUTE },
    async (request) => {
      requireSuperadmin(request);
      const record = writableSite(request.params.slug);

      // `specs/api/admin.md`: 409 `site_in_use` while any document names it
      // — deleting it would silently move those documents to the default
      // site and change the hostname their participants were already sent.
      const inUse = fastify.storage.readModel
        .listDocuments()
        .filter((entry) => entry.record.site === record.slug)
        .map((entry) => entry.record.slug);
      if (inUse.length > 0) {
        throw new ApiError(
          "site_in_use",
          `'${record.slug}' still has ${inUse.length} document(s): ${inUse.join(", ")}.`,
          { documents: inUse },
        );
      }

      const result = await fastify.storage.commit(
        "site-remove",
        {
          actor: adminActor(request),
          subject: `site-remove: ${record.slug}`,
          site: record.slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.sites.delete(record);
        },
      );

      return { ok: true, commit: result.commitHash };
    },
  );

  fastify.get<{ Params: SlugParams }>(
    "/sites/:slug/operators",
    { config: OPERATOR_ROUTE },
    async (request) => {
      const site = visibleSite(request, request.params.slug);
      const emails = new Set(siteOperatorGroup(fastify, site.slug));
      return fastify.storage.readModel
        .listOperators()
        .filter((operator) => emails.has(operator.email.toLowerCase()))
        .map((operator) => ({
          email: operator.email,
          name: operator.name,
          kind: operator.kind,
          active: operator.active,
          superadmin: operator.superadmin === true,
        }));
    },
  );

  /**
   * `specs/behaviors/sites.md`: managing a site's operator group is **not**
   * a superadmin action — any operator of the site may add or remove
   * members of it.
   */
  function requireGroupMember(request: FastifyRequest, slug: string): void {
    const { email, superadmin } = caller(request);
    if (!superadmin && !isSiteOperator(fastify, slug, email)) throw noSite(slug);
  }

  fastify.post<{ Params: SlugParams; Body: AddSiteOperatorBody }>(
    "/sites/:slug/operators",
    {
      config: OPERATOR_ROUTE,
      schema: {
        body: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string" }, name: { type: "string" } },
        },
      },
    },
    async (request) => {
      const record = writableSite(request.params.slug);
      requireGroupMember(request, record.slug);
      const email = request.body.email.trim().toLowerCase();

      const existing = fastify.storage.readModel.getOperatorByEmail(email);
      if (existing && !existing.active) {
        throw new ApiError("validation_failed", `'${email}' is not an active operator.`, {
          field: "email",
        });
      }
      if (record.operators.includes(email)) {
        return { ok: true, added: false, operators: record.operators };
      }

      const actor = adminActor(request);
      const result = await fastify.storage.commit(
        "site-operator-add",
        {
          actor,
          subject: `site-operator-add: ${email} on ${record.slug}`,
          site: record.slug,
          requestId: request.requestId,
        },
        async (tx) => {
          if (!existing) {
            const ids = new Set(fastify.storage.readModel.listOperators().map((o) => o.id));
            let id = email.split("@")[0] ?? email;
            id = id.replace(/[^a-z0-9-]/gu, "-");
            let candidate = id;
            let n = 2;
            while (ids.has(candidate)) candidate = `${id}-${n++}`;
            await tx.operators.upsert({
              id: candidate,
              email,
              name: request.body.name?.trim() || email,
              kind: "person",
              active: true,
            });
          }
          await tx.sites.patch({ slug: record.slug }, { operators: [...record.operators, email] });
        },
      );

      return {
        ok: true,
        added: true,
        operators: fastify.storage.readModel.getSite(record.slug)?.operators ?? [],
        commit: result.commitHash,
      };
    },
  );

  fastify.delete<{ Params: SlugEmailParams }>(
    "/sites/:slug/operators/:email",
    { config: OPERATOR_ROUTE },
    async (request) => {
      const record = writableSite(request.params.slug);
      requireGroupMember(request, record.slug);
      const email = request.params.email.trim().toLowerCase();

      if (!record.operators.includes(email)) {
        return { ok: true, removed: false };
      }
      // `specs/behaviors/sites.md`: "a group is never emptied: a removal
      // that would leave a site with no operators, or leave one of that
      // site's documents with no operator, is refused."
      if (record.operators.length <= 1) {
        throw new ApiError("last_operator", `'${record.slug}' would be left with no operators.`, {
          site: record.slug,
        });
      }
      const orphaned = fastify.storage.readModel
        .listDocuments()
        .filter((entry) => entry.record.site === record.slug)
        .find(
          (entry) =>
            entry.record.operators?.includes(email) && (entry.record.operators?.length ?? 0) <= 1,
        );
      if (orphaned) {
        throw new ApiError(
          "last_operator",
          `Removing ${email} would leave '${orphaned.record.slug}' with no operators.`,
          { document: orphaned.record.slug },
        );
      }

      const result = await fastify.storage.commit(
        "site-operator-remove",
        {
          actor: adminActor(request),
          subject: `site-operator-remove: ${email} on ${record.slug}`,
          site: record.slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.sites.patch(
            { slug: record.slug },
            { operators: record.operators.filter((e) => e !== email) },
          );
        },
      );

      return { ok: true, removed: true, commit: result.commitHash };
    },
  );
};

export default sitesRoute;
