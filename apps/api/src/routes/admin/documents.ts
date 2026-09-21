import {
  type Audience,
  audienceOf,
  type Capacity,
  type PublicAccess,
  type ShowSignatories,
} from "@community-drafter/shared";
import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import type { DeadlineChange } from "../../events/bus.ts";
import { DOCUMENT_SCOPED_ROUTE, OPERATOR_ROUTE } from "../../gateway/gateway.ts";
import { documentSummary } from "../../lib/document-summary.ts";
import { versionListView } from "../../lib/versions.ts";
import { invitationTemplate } from "../../notifications/templates.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface CreateDocumentBody {
  slug: string;
  title: string;
  capacities?: Capacity[];
  audience: Audience;
  addressed_to?: string[];
  public_access?: PublicAccess;
  show_signatories?: ShowSignatories;
  sender_name: string;
  reply_to: string;
  revocation_window_hours?: number;
  tags?: string[];
}

interface PatchDocumentBody {
  title?: string;
  capacities?: Capacity[];
  audience?: Audience;
  addressed_to?: string[];
  public_access?: PublicAccess;
  show_signatories?: ShowSignatories;
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

/**
 * `specs/api/admin.md` § open/extend/reopen: deadlines are ISO 8601 with a
 * zone (an offset or `Z`); anything else is 422 `validation_failed` naming
 * the field. Stored normalized to UTC so the record never carries a local
 * time that the schema's `date-time` format would reject as a 500.
 */
function parseDeadline(value: unknown, field: string): string {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:?\d\d)$/u.test(value.trim())) {
    throw new ApiError(
      "validation_failed",
      `${field} must be an ISO 8601 date-time with a time zone, e.g. 2026-10-01T21:00:00Z or 2026-10-01T17:00:00-04:00.`,
      { field },
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("validation_failed", `${field} is not a valid date-time.`, { field });
  }
  return date.toISOString();
}

/**
 * The deadlines this patch moves, paired with what they were — the payload
 * `schedule-changed` needs to say "Comments close moved from … to …"
 * (`specs/behaviors/notifications.md` § Content rules). Must be called
 * before the commit, while `previous` is still the pre-change record.
 */
/** How a deadline is named in a commit subject a person will read. */
const DEADLINE_LABELS: Record<DeadlineChange["deadline"], string> = {
  comments_close_at: "comments",
  signing_closes_at: "signing",
};

function deadlineChanges(
  patch: Record<string, string>,
  previous: { comments_close_at?: string; signing_closes_at?: string },
): DeadlineChange[] {
  const changes: DeadlineChange[] = [];
  for (const deadline of ["comments_close_at", "signing_closes_at"] as const) {
    const to = patch[deadline];
    if (to === undefined) continue;
    const from = previous[deadline];
    if (from === to) continue;
    changes.push({ deadline, ...(from ? { from } : {}), to });
  }
  return changes;
}

/**
 * `specs/data-model.md` § Audience + `specs/api/admin.md` § Documents:
 * `addressed_to` is required when the audience is `closed`, because a
 * closed statement that names no recipient tells a signer nothing about who
 * will read their name. The check runs against the document as it will be
 * *after* the write, so a patch that moves only one of the pair is still
 * judged on the pair.
 *
 * The audience itself is stored as given and is never written to (or read
 * from) `public_access`: one says who the finished statement goes to, the
 * other who may read the working draft.
 */
function assertAddressedTo(audience: Audience, addressedTo: string[] | undefined): void {
  if (audience !== "closed") return;
  if (addressedTo !== undefined && addressedTo.length > 0) return;
  throw new ApiError(
    "validation_failed",
    "A closed document must name who the statement is addressed to.",
    { field: "addressed_to" },
  );
}

const documentsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/documents", { config: OPERATOR_ROUTE }, async (request) => {
    const principal = request.principal!;
    const email = principal.kind === "operator" ? principal.email : "";
    // `specs/api/admin.md`: "List documents → returns only the caller's
    // documents"; a superadmin sees every document (`behaviors/operators.md`).
    const superadmin = principal.kind === "operator" && principal.superadmin;
    return fastify.storage.readModel
      .listDocuments()
      .filter((entry) => superadmin || entry.record.operators?.includes(email))
      .map((entry) => documentSummary(fastify, entry));
  });

  fastify.post<{ Body: CreateDocumentBody }>(
    "/documents",
    {
      config: OPERATOR_ROUTE,
      schema: {
        body: {
          type: "object",
          required: ["slug", "title", "audience", "sender_name", "reply_to"],
          properties: {
            slug: { type: "string" },
            title: { type: "string", minLength: 1 },
            capacities: {
              type: "array",
              items: { type: "string", enum: ["personal", "official"] },
            },
            audience: { type: "string", enum: ["public", "closed"] },
            addressed_to: { type: "array", items: { type: "string" } },
            public_access: { type: "string", enum: ["none", "read", "participate"] },
            show_signatories: { type: "string", enum: ["list", "count", "none"] },
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
      assertAddressedTo(body.audience, body.addressed_to);
      if (fastify.storage.readModel.getDocument(body.slug)) {
        throw new ApiError("validation_failed", `A document '${body.slug}' already exists.`, {
          field: "slug",
        });
      }

      const actor = adminActor(request);
      // `specs/behaviors/operators.md`: "Any active operator may create a
      // document. The creator becomes its first operator
      // (`documents.created_by`) and is listed in `documents.operators`."
      const callerEmail = actor.kind === "operator" ? actor.email : "";

      const result = await fastify.storage.commit(
        "create",
        {
          actor,
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
            audience: body.audience,
            addressed_to: body.addressed_to,
            public_access: body.public_access,
            show_signatories: body.show_signatories,
            created_by: callerEmail,
            operators: [callerEmail],
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
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      return { ...documentSummary(fastify, entry), versions: versionListView(fastify, entry) };
    },
  );

  fastify.patch<{ Params: DocumentParams; Body: PatchDocumentBody }>(
    "/documents/:slug",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;

      // `specs/api/admin.md`: the `closed` requirement is checked against
      // the document as it will be after the patch, so setting the audience
      // and its recipients in one request works and setting only one of
      // them cannot leave the pair inconsistent.
      assertAddressedTo(
        request.body.audience ?? audienceOf(entry.record),
        request.body.addressed_to ?? entry.record.addressed_to,
      );

      const allowedKeys = [
        "title",
        "capacities",
        "audience",
        "addressed_to",
        "public_access",
        "show_signatories",
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
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const comments_close_at = parseDeadline(request.body.comments_close_at, "comments_close_at");
      const signing_closes_at = parseDeadline(request.body.signing_closes_at, "signing_closes_at");
      if (new Date(comments_close_at) <= new Date()) {
        // `behaviors/document-lifecycle.md` § Opening: a document opens into
        // its comment period, never straight into closed.
        throw new ApiError("validation_failed", "comments_close_at must be in the future.", {
          field: "comments_close_at",
        });
      }
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
      const toInvite = participations.filter((p) => !p.record.sent_at && !p.record.link_revoked);

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
        },
      );

      // `specs/behaviors/notifications.md` § Sending: the invitation's
      // `sent_at` lands in the dispatcher's success commit, alongside
      // `notified.invitation`, so opening a document never claims to have
      // reached someone the mailer rejected. `isAlreadyNotified` is off
      // because `sent_at` — filtered above — is this route's own record of
      // who has been invited.
      const sentAt = new Date().toISOString();
      const delivery = await fastify.notifications.deliver({
        document: slug,
        eventKey: "invitation",
        actor: adminActor(request),
        requestId: request.requestId,
        notifiedValue: sentAt,
        isAlreadyNotified: () => false,
        alsoSet: { sent_at: sentAt },
        targets: toInvite.map((entryToInvite) => ({
          person: entryToInvite.record.person,
          markNotified: true,
          render: (ctx) => invitationTemplate(ctx),
        })),
      });

      return {
        ...documentSummary(
          fastify,
          fastify.storage.readModel.getDocument(slug)!,
          result.commitHash,
        ),
        invitations: {
          sent: delivery.sent,
          failed: delivery.failed,
          failures: delivery.failures,
        },
      };
    },
  );

  fastify.post<{ Params: DocumentParams; Body: ScheduleBody }>(
    "/documents/:slug/schedule",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const comments_close_at =
        request.body.comments_close_at === undefined
          ? undefined
          : parseDeadline(request.body.comments_close_at, "comments_close_at");
      const signing_closes_at =
        request.body.signing_closes_at === undefined
          ? undefined
          : parseDeadline(request.body.signing_closes_at, "signing_closes_at");

      /**
       * `specs/api/admin.md` § schedule: a document that has never been
       * opened has no deadline to extend, and answering that with
       * "comments_close_at must move later" reports a stored field to
       * someone who needs to be told the document is not open yet (#60).
       */
      const requireExisting = (current: string | undefined, label: string, field: string): void => {
        if (current) return;
        throw new ApiError(
          "no_deadline_set",
          `This document has no ${label} to extend. Open it first: drafter-axi docs open ${slug}.`,
          { field },
        );
      };

      const patch: Record<string, string> = {};
      if (comments_close_at !== undefined) {
        requireExisting(entry.record.comments_close_at, "comment deadline", "comments_close_at");
        if (new Date(comments_close_at) <= new Date(entry.record.comments_close_at ?? 0)) {
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
        requireExisting(entry.record.signing_closes_at, "signing deadline", "signing_closes_at");
        if (new Date(signing_closes_at) <= new Date(entry.record.signing_closes_at ?? 0)) {
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

      // `specs/behaviors/document-lifecycle.md` § Extension: the change is
      // "announced to subscribers of phase changes with old and new times",
      // so carry the previous values on the event before the record moves.
      const changes = deadlineChanges(patch, entry.record);

      const result = await fastify.storage.commit(
        "extend",
        {
          actor: adminActor(request),
          // `specs/data-model.md` § Commits are the events: the subject of
          // an extension names where each deadline landed ("extend:
          // coalition-charter signing to 2026-09-30T21:00Z"); the
          // `Deadlines` trailer carries the pairs a reader can compute from.
          subject: `extend: ${slug} ${changes
            .map((change) => `${DEADLINE_LABELS[change.deadline]} to ${change.to}`)
            .join(", ")}`.trim(),
          document: slug,
          deadlines: changes,
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
        changes,
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
    { config: DOCUMENT_SCOPED_ROUTE },
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
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const comments_close_at =
        request.body.comments_close_at === undefined
          ? undefined
          : parseDeadline(request.body.comments_close_at, "comments_close_at");
      const signing_closes_at = parseDeadline(request.body.signing_closes_at, "signing_closes_at");

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

      const changes = deadlineChanges(patch, entry.record);

      const result = await fastify.storage.commit(
        "reopen",
        {
          actor: adminActor(request),
          subject: `reopen: ${slug}`,
          document: slug,
          deadlines: changes,
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
        changes,
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
    { config: DOCUMENT_SCOPED_ROUTE },
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
