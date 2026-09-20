import type { OperatorKind } from "@community-drafter/shared";
import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { DOCUMENT_SCOPED_ROUTE, OPERATOR_ROUTE } from "../../gateway/gateway.ts";
import { uniqueSlug } from "../../lib/slug.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface EmailParams {
  email: string;
}

interface DocumentEmailParams extends DocumentParams {
  email: string;
}

interface CreateOperatorBody {
  email: string;
  name: string;
  kind?: OperatorKind;
  title?: string;
  org?: string;
  notes?: string;
}

interface PatchOperatorBody {
  name?: string;
  active?: boolean;
  title?: string;
  org?: string;
  notes?: string;
}

interface AddDocOperatorBody {
  email: string;
}

function operatorView(o: {
  email: string;
  name: string;
  kind: OperatorKind;
  active: boolean;
  title?: string;
  org?: string;
}) {
  return {
    email: o.email,
    name: o.name,
    kind: o.kind,
    active: o.active,
    title: o.title,
    org: o.org,
  };
}

/**
 * `specs/api/admin.md` § Operators + § Documents (the `.../operators`
 * sub-resource). `specs/behaviors/operators.md`: operator management is a
 * normal admin action — every change is a commit, and only an active
 * operator (not a platform-wide role) may make one.
 */
const operatorsRoute: FastifyPluginAsync = async (fastify) => {
  // --- Global operator directory ---

  fastify.get("/operators", { config: OPERATOR_ROUTE }, async () => {
    return fastify.storage.readModel.listOperators().map(operatorView);
  });

  fastify.post<{ Body: CreateOperatorBody }>(
    "/operators",
    {
      config: OPERATOR_ROUTE,
      schema: {
        body: {
          type: "object",
          required: ["email", "name"],
          properties: {
            email: { type: "string" },
            name: { type: "string", minLength: 1 },
            kind: { type: "string", enum: ["person", "bot"] },
            title: { type: "string" },
            org: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const email = body.email.trim().toLowerCase();
      if (fastify.storage.readModel.getOperatorByEmail(email)) {
        throw new ApiError("already_exists", `An operator '${email}' already exists.`, {
          field: "email",
        });
      }

      const existingIds = new Set(fastify.storage.readModel.listOperators().map((o) => o.id));
      const id = uniqueSlug(email.split("@")[0] ?? email, (candidate) =>
        existingIds.has(candidate),
      );

      const result = await fastify.storage.commit(
        "operator-add",
        {
          actor: adminActor(request),
          subject: `operator-add: ${email}`,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.operators.upsert({
            id,
            email,
            name: body.name,
            kind: body.kind ?? "person",
            active: true,
            title: body.title,
            org: body.org,
            notes: body.notes,
          });
        },
      );

      reply.status(201);
      return {
        ...operatorView(fastify.storage.readModel.getOperatorByEmail(email)!),
        commit: result.commitHash,
      };
    },
  );

  fastify.patch<{ Params: EmailParams; Body: PatchOperatorBody }>(
    "/operators/:email",
    { config: OPERATOR_ROUTE },
    async (request) => {
      const email = request.params.email.trim().toLowerCase();
      const existing = fastify.storage.readModel.getOperatorByEmail(email);
      if (!existing) throw new ApiError("not_found", `No operator '${email}'.`);

      const principal = request.principal!;
      const callerEmail = principal.kind === "operator" ? principal.email.toLowerCase() : "";
      if (request.body.active === false && callerEmail === email) {
        throw new ApiError(
          "validation_failed",
          "You cannot deactivate your own operator account.",
          {
            field: "active",
          },
        );
      }

      const allowedKeys = ["name", "active", "title", "org", "notes"] as const;
      const patch: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (request.body[key] !== undefined) patch[key] = request.body[key];
      }

      const result = await fastify.storage.commit(
        "operator-update",
        {
          actor: adminActor(request),
          subject: `operator-update: ${email}`,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.operators.patch({ id: existing.id }, patch);
        },
      );

      return {
        ...operatorView(fastify.storage.readModel.getOperatorByEmail(email)!),
        commit: result.commitHash,
      };
    },
  );

  fastify.delete<{ Params: EmailParams }>(
    "/operators/:email",
    { config: OPERATOR_ROUTE },
    async (request) => {
      const email = request.params.email.trim().toLowerCase();
      const existing = fastify.storage.readModel.getOperatorByEmail(email);
      if (!existing) throw new ApiError("not_found", `No operator '${email}'.`);

      // `specs/api/admin.md`: "drops the email from every document's
      // `operators` list in the same commit; 409 `last_operator` when that
      // would leave any document with none." Checked up front so the whole
      // removal is refused atomically rather than partially applied.
      const affected = fastify.storage.readModel
        .listDocuments()
        .filter((entry) => entry.record.operators?.includes(email));
      const wouldEmpty = affected.find((entry) => (entry.record.operators?.length ?? 0) <= 1);
      if (wouldEmpty) {
        throw new ApiError(
          "last_operator",
          `Removing ${email} would leave '${wouldEmpty.record.slug}' with no operators.`,
          { document: wouldEmpty.record.slug },
        );
      }

      const result = await fastify.storage.commit(
        "operator-remove",
        {
          actor: adminActor(request),
          subject: `operator-remove: ${email}`,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.operators.delete(existing);
          for (const entry of affected) {
            const next = (entry.record.operators ?? []).filter((e) => e !== email);
            await tx.documents.patch({ slug: entry.record.slug }, { operators: next });
          }
        },
      );

      return { ok: true, commit: result.commitHash };
    },
  );

  // --- Per-document operator membership ---

  fastify.get<{ Params: DocumentParams }>(
    "/documents/:slug/operators",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const emails = entry.record.operators ?? [];
      return emails
        .map((email) => fastify.storage.readModel.getOperatorByEmail(email))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map(operatorView);
    },
  );

  fastify.post<{ Params: DocumentParams; Body: AddDocOperatorBody }>(
    "/documents/:slug/operators",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const email = request.body.email.trim().toLowerCase();

      const candidate = fastify.storage.readModel.getOperatorByEmail(email);
      if (!candidate || !candidate.active) {
        throw new ApiError("validation_failed", `'${email}' is not an active operator.`, {
          field: "email",
        });
      }

      const current = entry.record.operators ?? [];
      if (current.includes(email)) {
        return { ...operatorView(candidate), added: false };
      }

      const result = await fastify.storage.commit(
        "doc-operator-add",
        {
          actor: adminActor(request),
          subject: `doc-operator-add: ${email} on ${slug}`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch({ slug }, { operators: [...current, email] });
        },
      );

      return { ...operatorView(candidate), added: true, commit: result.commitHash };
    },
  );

  fastify.delete<{ Params: DocumentEmailParams }>(
    "/documents/:slug/operators/:email",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const entry = fastify.storage.readModel.getDocument(request.params.slug);
      if (!entry) throw notFoundDocument(request.params.slug);
      const slug = entry.record.slug;
      const email = request.params.email.trim().toLowerCase();

      const current = entry.record.operators ?? [];
      if (!current.includes(email)) {
        return { ok: true, removed: false };
      }
      if (current.length <= 1) {
        throw new ApiError("last_operator", `'${slug}' would be left with no operators.`, {
          document: slug,
        });
      }

      const result = await fastify.storage.commit(
        "doc-operator-remove",
        {
          actor: adminActor(request),
          subject: `doc-operator-remove: ${email} on ${slug}`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.documents.patch({ slug }, { operators: current.filter((e) => e !== email) });
        },
      );

      return { ok: true, removed: true, commit: result.commitHash };
    },
  );
};

export default operatorsRoute;
