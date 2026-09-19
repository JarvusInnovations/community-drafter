import type { Capacity, PublicAccess, ShowSignatories } from "@community-drafter/shared";
import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { ADMIN_ROUTE } from "../../gateway/gateway.ts";
import { documentSummary } from "../../lib/document-summary.ts";
import { versionListView } from "../../lib/versions.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface CreateDocumentBody {
  slug: string;
  title: string;
  capacities?: Capacity[];
  public_access?: PublicAccess;
  show_signatories?: ShowSignatories;
  owner: string;
  sender_name: string;
  reply_to: string;
  revocation_window_hours?: number;
  tags?: string[];
}

interface PatchDocumentBody {
  title?: string;
  capacities?: Capacity[];
  public_access?: PublicAccess;
  show_signatories?: ShowSignatories;
  owner?: string;
  sender_name?: string;
  reply_to?: string;
  revocation_window_hours?: number;
  tags?: string[];
}

interface OpenBody {
  comments_close_at: string;
  signing_closes_at: string;
}

interface ScheduleBody {
  comments_close_at?: string;
  signing_closes_at?: string;
}

interface ReopenBody {
  comments_close_at?: string;
  signing_closes_at: string;
}

interface WithdrawBody {
  reason: string;
  public: boolean;
}

const documentsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/documents", { config: ADMIN_ROUTE }, async () => {
    return fastify.storage.readModel
      .listDocuments()
      .map((entry) => documentSummary(fastify, entry));
  });

  fastify.post<{ Body: CreateDocumentBody }>(
    "/documents",
    {
      config: ADMIN_ROUTE,
      schema: {
        body: {
          type: "object",
          required: ["slug", "title", "owner", "sender_name", "reply_to"],
          properties: {
            slug: { type: "string" },
            title: { type: "string", minLength: 1 },
            capacities: {
              type: "array",
              items: { type: "string", enum: ["personal", "official"] },
            },
            public_access: { type: "string", enum: ["none", "read", "participate"] },
            show_signatories: { type: "string", enum: ["list", "count", "none"] },
            owner: { type: "string" },
            sender_name: { type: "string" },
            reply_to: { type: "string" },
            revocation_window_hours: { type: "integer", minimum: 1 },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (fastify.storage.readModel.getDocument(body.slug)) {
        throw new ApiError("validation_failed", `A document '${body.slug}' already exists.`, {
          field: "slug",
        });
      }

      const result = await fastify.storage.commit(
        "create",
        {
          actor: adminActor(request),
          subject: `create: ${body.slug}`,
          document: body.slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.upsert({
            slug: body.slug,
            title: body.title,
            state: "draft",
            capacities: body.capacities,
            public_access: body.public_access,
            show_signatories: body.show_signatories,
            owner: body.owner,
            sender_name: body.sender_name,
            reply_to: body.reply_to,
            revocation_window_hours: body.revocation_window_hours,
            tags: body.tags,
            body: "",
          });
        },
      );

      reply.status(201);
      return documentSummary(
        fastify,
        fastify.storage.readModel.getDocument(body.slug)!,
        result.commitHash,
      );
    },
  );

  fastify.get<{ Params: DocumentParams }>(
    "/documents/:slug",
    { config: ADMIN_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      return { ...documentSummary(fastify, entry), versions: versionListView(fastify, entry) };
    },
  );

  fastify.patch<{ Params: DocumentParams; Body: PatchDocumentBody }>(
    "/documents/:slug",
    { config: ADMIN_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;

      const allowedKeys = [
        "title",
        "capacities",
        "public_access",
        "show_signatories",
        "owner",
        "sender_name",
        "reply_to",
        "revocation_window_hours",
        "tags",
      ] as const;
      const patch: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (request.body[key] !== undefined) patch[key] = request.body[key];
      }

      const result = await fastify.storage.commit(
        "settings",
        {
          actor: adminActor(request),
          subject: `settings: ${slug} updated`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch({ slug }, patch);
        },
      );

      return documentSummary(
        fastify,
        fastify.storage.readModel.getDocument(slug)!,
        result.commitHash,
      );
    },
  );

  fastify.post<{ Params: DocumentParams; Body: OpenBody }>(
    "/documents/:slug/open",
    { config: ADMIN_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const { comments_close_at, signing_closes_at } = request.body;

      if (new Date(comments_close_at) >= new Date(signing_closes_at)) {
        throw new ApiError(
          "validation_failed",
          "comments_close_at must be earlier than signing_closes_at.",
          { field: "comments_close_at" },
        );
      }
      if (entry.versions.length === 0) {
        throw new ApiError("no_version", "This document has no published version to open with.");
      }

      const now = new Date().toISOString();
      const participations = fastify.storage.readModel.listParticipationsForDocument(slug);
      const toInvite = participations.filter((p) => !p.record.sent_at);

      const result = await fastify.storage.commit(
        "open",
        {
          actor: adminActor(request),
          subject: `open: ${slug} comments and signing`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch(
            { slug },
            { state: "open", opened_at: now, comments_close_at, signing_closes_at },
          );
          for (const entryToInvite of toInvite) {
            const current = await tx.participations.queryFirst({
              document: slug,
              person: entryToInvite.record.person,
            });
            if (!current) continue;
            await tx.participations.patch(
              { document: slug, person: entryToInvite.record.person },
              { sent_at: now, notified: { ...current.notified, invitation: now } },
            );
          }
        },
      );

      await fastify.events.publish({
        type: "invite",
        document: slug,
        people: toInvite.map((p) => p.record.person),
        commit: result.commitHash ?? "",
      });

      return documentSummary(
        fastify,
        fastify.storage.readModel.getDocument(slug)!,
        result.commitHash,
      );
    },
  );

  fastify.post<{ Params: DocumentParams; Body: ScheduleBody }>(
    "/documents/:slug/schedule",
    { config: ADMIN_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const { comments_close_at, signing_closes_at } = request.body;

      const patch: Record<string, string> = {};
      if (comments_close_at !== undefined) {
        if (
          !entry.record.comments_close_at ||
          new Date(comments_close_at) <= new Date(entry.record.comments_close_at)
        ) {
          throw new ApiError(
            "deadline_not_later",
            "comments_close_at must move later, never earlier.",
            {
              current: entry.record.comments_close_at,
            },
          );
        }
        patch.comments_close_at = comments_close_at;
      }
      if (signing_closes_at !== undefined) {
        if (
          !entry.record.signing_closes_at ||
          new Date(signing_closes_at) <= new Date(entry.record.signing_closes_at)
        ) {
          throw new ApiError(
            "deadline_not_later",
            "signing_closes_at must move later, never earlier.",
            {
              current: entry.record.signing_closes_at,
            },
          );
        }
        patch.signing_closes_at = signing_closes_at;
      }

      const nextComments = patch.comments_close_at ?? entry.record.comments_close_at;
      const nextSigning = patch.signing_closes_at ?? entry.record.signing_closes_at;
      if (nextComments && nextSigning && new Date(nextComments) >= new Date(nextSigning)) {
        throw new ApiError(
          "validation_failed",
          "comments_close_at must remain earlier than signing_closes_at.",
        );
      }

      const result = await fastify.storage.commit(
        "extend",
        {
          actor: adminActor(request),
          subject: `extend: ${slug} ${Object.keys(patch).join(", ")}`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch({ slug }, patch);
        },
      );

      await fastify.events.publish({
        type: "schedule-changed",
        document: slug,
        commit: result.commitHash ?? "",
      });

      return documentSummary(
        fastify,
        fastify.storage.readModel.getDocument(slug)!,
        result.commitHash,
      );
    },
  );

  fastify.post<{ Params: DocumentParams }>(
    "/documents/:slug/close",
    { config: ADMIN_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      if (entry.record.state === "withdrawn") {
        throw new ApiError("phase_closed", "This document was withdrawn.", { phase: "withdrawn" });
      }

      const now = new Date().toISOString();
      const result = await fastify.storage.commit(
        "close",
        {
          actor: adminActor(request),
          subject: `close: ${slug} (admin)`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch({ slug }, { state: "closed", signing_closes_at: now });
        },
      );

      await fastify.events.publish({ type: "closed", document: slug });
      return documentSummary(
        fastify,
        fastify.storage.readModel.getDocument(slug)!,
        result.commitHash,
      );
    },
  );

  fastify.post<{ Params: DocumentParams; Body: ReopenBody }>(
    "/documents/:slug/reopen",
    { config: ADMIN_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const { comments_close_at, signing_closes_at } = request.body;

      const now = new Date();
      if (new Date(signing_closes_at) <= now) {
        throw new ApiError("validation_failed", "signing_closes_at must be in the future.", {
          field: "signing_closes_at",
        });
      }
      if (
        comments_close_at !== undefined &&
        new Date(comments_close_at) >= new Date(signing_closes_at)
      ) {
        throw new ApiError(
          "validation_failed",
          "comments_close_at must be earlier than signing_closes_at.",
          { field: "comments_close_at" },
        );
      }

      const patch: Record<string, string> = { state: "open", signing_closes_at };
      if (comments_close_at !== undefined) patch.comments_close_at = comments_close_at;

      const result = await fastify.storage.commit(
        "reopen",
        {
          actor: adminActor(request),
          subject: `reopen: ${slug}`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch({ slug }, patch);
        },
      );

      await fastify.events.publish({
        type: "schedule-changed",
        document: slug,
        commit: result.commitHash ?? "",
      });

      return documentSummary(
        fastify,
        fastify.storage.readModel.getDocument(slug)!,
        result.commitHash,
      );
    },
  );

  fastify.post<{ Params: DocumentParams; Body: WithdrawBody }>(
    "/documents/:slug/withdraw",
    { config: ADMIN_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const { reason, public: isPublic } = request.body;

      const result = await fastify.storage.commit(
        "withdraw",
        {
          actor: adminActor(request),
          subject: `withdraw: ${slug}`,
          document: slug,
          reason,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch(
            { slug },
            { state: "withdrawn", withdraw_reason: reason, withdraw_public: isPublic },
          );
        },
      );

      return documentSummary(
        fastify,
        fastify.storage.readModel.getDocument(slug)!,
        result.commitHash,
      );
    },
  );
};

export default documentsRoute;
