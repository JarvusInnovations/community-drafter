import type { Capacity } from "@community-drafter/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { ApiError } from "../../errors.ts";
import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { toCsv } from "../../lib/csv.ts";
import { prefOn } from "../../lib/notify.ts";
import { participationStatus } from "../../lib/participation-status.ts";
import { buildPrefsView } from "../../lib/prefs.ts";
import { buildSignatureView } from "../../lib/signature-view.ts";
import { uniqueSlug } from "../../lib/slug.ts";
import { mintUniqueToken } from "../../lib/tokens.ts";
import { adminActor, notFoundDocument } from "./context.ts";

interface DocumentParams {
  slug: string;
}

interface PersonParams extends DocumentParams {
  person: string;
}

interface ImportRow {
  name: string;
  email: string;
  phone?: string;
  org?: string;
  role?: string;
  descriptor?: string;
  external_id?: string;
  suggested_capacity?: Capacity;
  tags?: string[];
}

interface ListInvitationsQuery {
  status?: string;
  source?: string;
  q?: string;
}

interface SendBody {
  only_unsent?: boolean;
  person?: string[];
}

interface LinksBody {
  person?: string[];
}

interface ExpireBody {
  expires_at: string;
}

interface RemindBody {
  target: "unopened" | "opened_not_acted";
  dry_run?: boolean;
}

function publicLink(fastify: { config: { PUBLIC_URL?: string } }, token: string): string {
  const base = fastify.config.PUBLIC_URL ?? "";
  return `${base}/i/${token}`;
}

function parseImportRows(request: FastifyRequest): ImportRow[] {
  const raw = request.body as unknown;
  if (Array.isArray(raw)) return raw as ImportRow[];
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ImportRow);
  }
  throw new ApiError("invalid_request", "Expected a JSON array or NDJSON body of import rows.");
}

const invitationsRoute: FastifyPluginAsync = async (fastify) => {
  // NDJSON is a line-delimited body, not a single JSON document — parse it
  // as raw text here and split in the handler, alongside the ordinary JSON
  // array Fastify already parses for `application/json`.
  fastify.addContentTypeParser(
    ["application/x-ndjson", "text/plain"],
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  fastify.post<{ Params: DocumentParams }>(
    "/documents/:slug/invitations/import",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const rows = parseImportRows(request);

      let peopleCreated = 0;
      let peopleUpdated = 0;
      let invitationsCreated = 0;
      let skippedExisting = 0;

      const result = await fastify.storage.commit(
        "invite",
        {
          actor: adminActor(request),
          subject: `invite: ${rows.length} people on ${slug}`,
          document: slug,
          requestId: request.requestId,
        },
        async (tx) => {
          const takenIds = new Set<string>();
          const mintedTokens = new Set<string>();
          for (const row of rows) {
            const email = row.email.trim();
            const existing = await tx.people.queryFirst({
              email: (value) => value.toLowerCase() === email.toLowerCase(),
            });

            let personId: string;
            if (existing) {
              personId = existing.id;
              await tx.people.patch(
                { id: existing.id },
                {
                  name: row.name ?? existing.name,
                  phone: row.phone ?? existing.phone,
                  org: row.org ?? existing.org,
                  role: row.role ?? existing.role,
                  descriptor: row.descriptor ?? existing.descriptor,
                  external_id: row.external_id ?? existing.external_id,
                },
              );
              peopleUpdated += 1;
            } else {
              personId = uniqueSlug(row.name, (candidate) => {
                if (takenIds.has(candidate)) return true;
                if (fastify.storage.readModel.getPerson(candidate)) return true;
                return false;
              });
              takenIds.add(personId);
              await tx.people.upsert({
                id: personId,
                name: row.name,
                email,
                phone: row.phone,
                org: row.org,
                role: row.role,
                descriptor: row.descriptor,
                external_id: row.external_id,
                source: "crm",
              });
              peopleCreated += 1;
            }

            const existingParticipation = await tx.participations.queryFirst({
              document: slug,
              person: personId,
            });
            if (existingParticipation) {
              skippedExisting += 1;
              continue;
            }

            const token = mintUniqueToken(
              (candidate) =>
                mintedTokens.has(candidate) ||
                Boolean(fastify.storage.readModel.getParticipationByToken(candidate)),
            );
            mintedTokens.add(token);
            await tx.participations.upsert({
              document: slug,
              person: personId,
              token,
              source: "crm",
              suggested_capacity: row.suggested_capacity,
            });
            invitationsCreated += 1;
          }
        },
      );

      return {
        people_created: peopleCreated,
        people_updated: peopleUpdated,
        invitations_created: invitationsCreated,
        skipped_existing: skippedExisting,
        commit: result.commitHash,
      };
    },
  );

  fastify.get<{ Params: DocumentParams; Querystring: ListInvitationsQuery }>(
    "/documents/:slug/invitations",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const { status, source, q } = request.query;

      const rows = fastify.storage.readModel.listParticipationsForDocument(slug).map((entry) => {
        const person = fastify.storage.readModel.getPerson(entry.record.person);
        return {
          person: entry.record.person,
          name: person?.name ?? "",
          email: person?.email ?? "",
          status: participationStatus(fastify, entry),
          source: entry.record.source,
          opened_at: entry.record.first_opened_at,
          last_seen_at: entry.record.last_seen_at,
          opens: entry.record.opens ?? 0,
          sent_at: entry.record.sent_at,
          link_revoked: entry.record.link_revoked ?? false,
          signature: buildSignatureView(entry),
          notify: buildPrefsView(entry),
        };
      });

      return rows.filter((row) => {
        if (status && row.status !== status) return false;
        if (source && row.source !== source) return false;
        if (q) {
          const needle = q.toLowerCase();
          if (
            !row.name.toLowerCase().includes(needle) &&
            !row.email.toLowerCase().includes(needle)
          ) {
            return false;
          }
        }
        return true;
      });
    },
  );

  fastify.post<{ Params: DocumentParams; Body: SendBody }>(
    "/documents/:slug/invitations/send",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const { only_unsent, person } = request.body ?? {};

      let candidates = fastify.storage.readModel.listParticipationsForDocument(slug);
      if (person && person.length > 0) {
        const wanted = new Set(person);
        candidates = candidates.filter((entry) => wanted.has(entry.record.person));
      } else {
        candidates = candidates.filter((entry) => !entry.record.sent_at);
      }
      if (only_unsent) {
        candidates = candidates.filter((entry) => !entry.record.sent_at);
      }
      candidates = candidates.filter((entry) => !entry.record.link_revoked);

      const now = new Date().toISOString();
      const rows: string[][] = [];
      for (const entry of candidates) {
        const personRecord = fastify.storage.readModel.getPerson(entry.record.person);
        rows.push([
          personRecord?.name ?? entry.record.person,
          personRecord?.email ?? "",
          `[${document.record.title}] — You're invited to review`,
          publicLink(fastify, entry.record.token),
        ]);
      }

      let commitHash: string | null = null;
      if (candidates.length > 0) {
        const result = await fastify.storage.commit(
          "send",
          {
            actor: adminActor(request),
            subject: `send: invitations for ${slug} (${candidates.length} recipients)`,
            document: slug,
            requestId: request.requestId,
          },
          async (tx) => {
            for (const entry of candidates) {
              const current = await tx.participations.queryFirst({
                document: slug,
                person: entry.record.person,
              });
              if (!current) continue;
              await tx.participations.patch(
                { document: slug, person: entry.record.person },
                { sent_at: now, notified: { ...current.notified, invitation: now } },
              );
            }
          },
        );
        commitHash = result.commitHash;
      }

      await fastify.events.publish({
        type: "send",
        document: slug,
        people: candidates.map((entry) => entry.record.person),
        commit: commitHash ?? "",
      });

      const response: Record<string, unknown> = { queued: candidates.length, commit: commitHash };
      if (fastify.config.MAILER === "export") {
        response.csv = toCsv(["name", "email", "subject", "link"], rows);
      }
      return response;
    },
  );

  fastify.post<{ Params: DocumentParams; Body: LinksBody }>(
    "/documents/:slug/invitations/links",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request, reply) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const { person } = request.body ?? {};

      let candidates = fastify.storage.readModel.listParticipationsForDocument(slug);
      if (person && person.length > 0) {
        const wanted = new Set(person);
        candidates = candidates.filter((entry) => wanted.has(entry.record.person));
      }

      const now = new Date().toISOString();
      const rows: string[][] = [];
      for (const entry of candidates) {
        const personRecord = fastify.storage.readModel.getPerson(entry.record.person);
        rows.push([
          entry.record.person,
          personRecord?.name ?? "",
          personRecord?.email ?? "",
          publicLink(fastify, entry.record.token),
        ]);
      }

      if (candidates.length > 0) {
        await fastify.storage.commit(
          "link-export",
          {
            actor: adminActor(request),
            subject: `link-export: ${candidates.length} tokens for ${slug}`,
            document: slug,
            requestId: request.requestId,
          },
          async (tx) => {
            for (const entry of candidates) {
              const current = await tx.participations.queryFirst({
                document: slug,
                person: entry.record.person,
              });
              if (!current) continue;
              await tx.participations.patch(
                { document: slug, person: entry.record.person },
                { notified: { ...current.notified, "links-exported": now } },
              );
            }
          },
        );
      }

      // CSV is this route's documented shape (`specs/api/admin.md`); the
      // commit that recorded the export isn't retrievable from a CSV body,
      // so this stays the one admin write endpoint without a `commit` field
      // in its response.
      const csv = toCsv(["person", "name", "email", "link"], rows);
      reply.header("content-type", "text/csv; charset=utf-8");
      return csv;
    },
  );

  fastify.post<{ Params: PersonParams }>(
    "/documents/:slug/invitations/:person/revoke-link",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const person = request.params.person;
      const participation = fastify.storage.readModel.getParticipation(slug, person);
      if (!participation)
        throw new ApiError("not_found", `No invitation for '${person}' on '${slug}'.`);

      const result = await fastify.storage.commit(
        "link-revoke",
        {
          actor: adminActor(request),
          subject: `link-revoke: ${person} on ${slug}`,
          document: slug,
          person,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.participations.patch({ document: slug, person }, { link_revoked: true });
        },
      );

      return { revoked: true, commit: result.commitHash };
    },
  );

  fastify.post<{ Params: PersonParams }>(
    "/documents/:slug/invitations/:person/reissue-link",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const person = request.params.person;
      const participation = fastify.storage.readModel.getParticipation(slug, person);
      if (!participation)
        throw new ApiError("not_found", `No invitation for '${person}' on '${slug}'.`);

      const token = mintUniqueToken((candidate) =>
        Boolean(fastify.storage.readModel.getParticipationByToken(candidate)),
      );

      const result = await fastify.storage.commit(
        "link-reissue",
        {
          actor: adminActor(request),
          subject: `link-reissue: ${person} on ${slug}`,
          document: slug,
          person,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.participations.patch({ document: slug, person }, { token, link_revoked: false });
        },
      );

      return { link: publicLink(fastify, token), commit: result.commitHash };
    },
  );

  fastify.post<{ Params: PersonParams; Body: ExpireBody }>(
    "/documents/:slug/invitations/:person/expire",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const person = request.params.person;
      const participation = fastify.storage.readModel.getParticipation(slug, person);
      if (!participation)
        throw new ApiError("not_found", `No invitation for '${person}' on '${slug}'.`);

      await fastify.storage.commit(
        "link-expire",
        {
          actor: adminActor(request),
          subject: `link-expire: ${person} on ${slug}`,
          document: slug,
          person,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.participations.patch(
            { document: slug, person },
            { expires_at: request.body.expires_at },
          );
        },
      );

      return { expires_at: request.body.expires_at };
    },
  );

  fastify.post<{ Params: DocumentParams; Body: RemindBody }>(
    "/documents/:slug/invitations/remind",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const { target, dry_run } = request.body;

      const candidates = fastify.storage.readModel
        .listParticipationsForDocument(slug)
        .filter((entry) => !entry.record.link_revoked)
        .filter((entry) => prefOn(entry, "reminders"))
        .filter((entry) => {
          const status = participationStatus(fastify, entry);
          if (target === "unopened") return status === "unopened";
          return status === "opened";
        });

      if (dry_run) {
        return { targeted: candidates.length, dry_run: true };
      }

      let commitHash: string | null = null;
      if (candidates.length > 0) {
        const result = await fastify.storage.commit(
          "send",
          {
            actor: adminActor(request),
            subject: `send: reminders for ${slug} (${candidates.length} recipients)`,
            document: slug,
            requestId: request.requestId,
          },
          async (tx) => {
            for (const entry of candidates) {
              const current = await tx.participations.queryFirst({
                document: slug,
                person: entry.record.person,
              });
              if (!current) continue;
              const priorCount =
                typeof current.notified?.reminder === "number" ? current.notified.reminder : 0;
              await tx.participations.patch(
                { document: slug, person: entry.record.person },
                { notified: { ...current.notified, reminder: priorCount + 1 } },
              );
            }
          },
        );
        commitHash = result.commitHash;
      }

      await fastify.events.publish({
        type: "remind",
        document: slug,
        people: candidates.map((entry) => entry.record.person),
        commit: commitHash ?? "",
      });

      return { targeted: candidates.length, dry_run: false, commit: commitHash };
    },
  );
};

export default invitationsRoute;
