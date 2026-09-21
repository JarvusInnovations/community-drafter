import type { Capacity } from "@community-drafter/shared";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

import { ApiError } from "../../errors.ts";
import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { toCsv } from "../../lib/csv.ts";
import { lastMessagedAt, prefOn } from "../../lib/notify.ts";
import { participationStatus } from "../../lib/participation-status.ts";
import { buildPrefsView } from "../../lib/prefs.ts";
import { buildSignatureView } from "../../lib/signature-view.ts";
import { uniqueSlug } from "../../lib/slug.ts";
import { mintUniqueToken } from "../../lib/tokens.ts";
import { personalLink } from "../../notifications/links.ts";
import { invitationTemplate, reminderTemplate } from "../../notifications/templates.ts";
import { siteForDocument } from "../../sites/site.ts";
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
  dry_run?: boolean;
}

interface LinksBody {
  person?: string[];
}

interface ExpireBody {
  expires_at: string;
}

interface RemindBody {
  target: "unopened" | "opened_not_acted";
  min_age_hours?: number;
  dry_run?: boolean;
}

/**
 * `specs/behaviors/notifications.md` § Sending: reminders keep a minimum
 * interval since this document last messaged the person, "default 48; `0`
 * disables the guard".
 */
const DEFAULT_REMINDER_MIN_AGE_HOURS = 48;

function parseMinAgeHours(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_REMINDER_MIN_AGE_HOURS;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ApiError(
      "validation_failed",
      "min_age_hours must be a number of hours, 0 or greater.",
      { field: "min_age_hours" },
    );
  }
  return value;
}

/**
 * `specs/behaviors/access-and-identity.md` § Personal links: a personal
 * link is built on the **document's site** hostname, never on the host this
 * admin request happened to arrive at (`specs/behaviors/sites.md`).
 */
function personalLinkFor(
  fastify: FastifyInstance,
  document: { site?: string },
  token: string,
): string {
  return personalLink(siteForDocument(fastify, document).baseUrl, token);
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

  fastify.post<{ Params: DocumentParams; Querystring: { dry_run?: string } }>(
    "/documents/:slug/invitations/import",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const rows = parseImportRows(request);
      const dryRun = request.query?.dry_run === "1" || request.query?.dry_run === "true";

      // `specs/api/admin.md` § People and invitations: the plan is computed
      // read-only first, so a dry run reports exactly what the commit below
      // would do — including which existing person fields a row overwrites.
      const plan: Array<{
        email: string;
        name: string;
        person: string;
        action: "invite_new_person" | "invite_existing_person" | "skip_existing";
        changes: string[];
      }> = [];
      const plannedIds = new Set<string>();
      for (const row of rows) {
        const email = row.email.trim();
        const existing = await fastify.storage.store.people.queryFirst({
          email: (value) => value.toLowerCase() === email.toLowerCase(),
        });
        const personId =
          existing?.id ??
          uniqueSlug(
            row.name,
            (candidate) =>
              plannedIds.has(candidate) || Boolean(fastify.storage.readModel.getPerson(candidate)),
          );
        if (!existing) plannedIds.add(personId);
        const changes: string[] = [];
        if (existing) {
          for (const field of [
            "name",
            "phone",
            "org",
            "role",
            "descriptor",
            "external_id",
          ] as const) {
            const next = row[field];
            if (next !== undefined && next !== existing[field]) changes.push(field);
          }
        }
        const alreadyOn = fastify.storage.readModel.getParticipation(slug, personId);
        plan.push({
          email,
          name: row.name,
          person: personId,
          action: alreadyOn
            ? "skip_existing"
            : existing
              ? "invite_existing_person"
              : "invite_new_person",
          changes,
        });
      }
      const counts = {
        people_created: plan.filter((p) => p.action === "invite_new_person").length,
        people_updated: plan.filter((p) => p.action !== "invite_new_person").length,
        invitations_created: plan.filter((p) => p.action !== "skip_existing").length,
        skipped_existing: plan.filter((p) => p.action === "skip_existing").length,
      };
      if (dryRun) {
        return { dry_run: true, ...counts, rows: plan, commit: null };
      }

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
            }

            const existingParticipation = await tx.participations.queryFirst({
              document: slug,
              person: personId,
            });
            if (existingParticipation) continue;

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
          }
        },
      );

      return { ...counts, rows: plan, commit: result.commitHash };
    },
  );

  /**
   * `specs/api/admin.md` § People and invitations: a staged invitation that
   * was never sent can be taken back (`Action: uninvite`). Once it has been
   * sent, opened, commented on or signed, the record is part of the story
   * and stays; the only options then are revoke-link or the normal flows.
   */
  fastify.delete<{ Params: PersonParams }>(
    "/documents/:slug/invitations/:person",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      const entry = fastify.storage.readModel.getParticipation(slug, request.params.person);
      if (!entry) {
        throw new ApiError(
          "not_found",
          `No invitation for '${request.params.person}' on '${slug}'.`,
        );
      }
      if (entry.record.sent_at) {
        throw new ApiError(
          "already_sent",
          `${request.params.person} has already been sent their invitation; revoke the link instead.`,
          { person: request.params.person, sent_at: entry.record.sent_at },
        );
      }
      const hasSubmission = fastify.storage.readModel
        .listSubmissionsForDocument(slug)
        .some((s) => s.record.person === request.params.person);
      if (entry.record.first_opened_at || entry.record.signature || hasSubmission) {
        throw new ApiError(
          "has_activity",
          `${request.params.person} has already acted on this document; the record stays.`,
          { person: request.params.person },
        );
      }

      const result = await fastify.storage.commit(
        "uninvite",
        {
          actor: adminActor(request),
          subject: `uninvite: ${request.params.person} on ${slug}`,
          document: slug,
          person: request.params.person,
          requestId: request.requestId,
        },
        async (tx) => {
          await tx.participations.delete(entry.record);
        },
      );
      return { ok: true, commit: result.commitHash };
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
      const { only_unsent, person, dry_run } = request.body ?? {};

      // `specs/api/admin.md`: who would receive one and who is skipped and
      // why, computed the same way for a dry run and a real send.
      const wanted = person && person.length > 0 ? new Set(person) : null;
      const all = fastify.storage.readModel.listParticipationsForDocument(slug);
      const candidates: typeof all = [];
      const skipped: Array<{
        person: string;
        reason: "already_sent" | "link_revoked" | "no_email";
      }> = [];
      for (const entry of all) {
        if (wanted && !wanted.has(entry.record.person)) continue;
        if (entry.record.link_revoked) {
          skipped.push({ person: entry.record.person, reason: "link_revoked" });
          continue;
        }
        if ((!wanted || only_unsent) && entry.record.sent_at) {
          skipped.push({ person: entry.record.person, reason: "already_sent" });
          continue;
        }
        const personRecord = fastify.storage.readModel.getPerson(entry.record.person);
        if (!personRecord?.email) {
          skipped.push({ person: entry.record.person, reason: "no_email" });
          continue;
        }
        candidates.push(entry);
      }

      if (dry_run) {
        return {
          dry_run: true,
          would_send: candidates.map((entry) => ({
            person: entry.record.person,
            name:
              fastify.storage.readModel.getPerson(entry.record.person)?.name ?? entry.record.person,
          })),
          skipped,
        };
      }

      // `specs/behaviors/notifications.md` § Sending: `sent_at` rides in the
      // dispatcher's success commit next to `notified.invitation`, so this
      // response counts deliveries rather than intentions and a rejected
      // recipient stays unsent for the next run to pick up. The
      // already-sent policy is the `skipped` loop above — a `--person`
      // re-send is deliberate — so the dispatcher's own idempotency skip is
      // turned off here.
      const sentAt = new Date().toISOString();
      const delivery = await fastify.notifications.deliver({
        document: slug,
        eventKey: "invitation",
        actor: adminActor(request),
        requestId: request.requestId,
        notifiedValue: sentAt,
        isAlreadyNotified: () => false,
        alsoSet: { sent_at: sentAt },
        targets: candidates.map((entry) => ({
          person: entry.record.person,
          markNotified: true,
          render: (ctx) => invitationTemplate(ctx),
        })),
      });

      const response: Record<string, unknown> = {
        sent: delivery.sent,
        failed: delivery.failed,
        skipped,
        failures: delivery.failures,
        commit: delivery.commit,
      };
      if (fastify.config.MAILER === "export") {
        // The CSV mirrors the rows the export mailer actually wrote.
        const sentPeople = new Set(delivery.sentPeople);
        const rows = candidates
          .filter((entry) => sentPeople.has(entry.record.person))
          .map((entry) => {
            const personRecord = fastify.storage.readModel.getPerson(entry.record.person);
            return [
              personRecord?.name ?? entry.record.person,
              personRecord?.email ?? "",
              `[${document.record.title}] — You're invited to review`,
              personalLinkFor(fastify, document.record, entry.record.token),
            ];
          });
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
          personalLinkFor(fastify, document.record, entry.record.token),
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

      return {
        link: personalLinkFor(fastify, document.record, token),
        commit: result.commitHash,
      };
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
      const minAgeHours = parseMinAgeHours(request.body.min_age_hours);
      const cutoff = Date.now() - minAgeHours * 3_600_000;

      const inTarget = fastify.storage.readModel
        .listParticipationsForDocument(slug)
        .filter((entry) => !entry.record.link_revoked)
        .filter((entry) => {
          const status = participationStatus(fastify, entry);
          if (target === "unopened") return status === "unopened";
          return status === "opened";
        });

      // `specs/behaviors/notifications.md` § Sending: a reminder never goes
      // to someone this document messaged within `min_age_hours`, and the
      // two reasons for not nudging someone are counted apart so a run that
      // sends nothing says which it was.
      let skippedPref = 0;
      let skippedRecent = 0;
      const candidates: typeof inTarget = [];
      for (const entry of inTarget) {
        if (!prefOn(entry, "reminders")) {
          skippedPref += 1;
          continue;
        }
        const last = lastMessagedAt(entry);
        if (last !== undefined && new Date(last).getTime() > cutoff) {
          skippedRecent += 1;
          continue;
        }
        candidates.push(entry);
      }

      if (dry_run) {
        return {
          dry_run: true,
          targeted: candidates.length,
          skipped_recent: skippedRecent,
          skipped_pref: skippedPref,
          min_age_hours: minAgeHours,
        };
      }

      // The reminder number is per person, so the count and its timestamp
      // are written here from the people the mailer actually accepted
      // rather than marked by the dispatcher — one commit, after delivery.
      const reminderNumber = new Map<string, number>();
      for (const entry of candidates) {
        const prior =
          typeof entry.record.notified?.reminder === "number" ? entry.record.notified.reminder : 0;
        reminderNumber.set(entry.record.person, prior + 1);
      }

      const delivery = await fastify.notifications.deliver({
        document: slug,
        eventKey: "reminder",
        actor: adminActor(request),
        requestId: request.requestId,
        targets: candidates.map((entry) => ({
          person: entry.record.person,
          markNotified: false,
          render: (ctx) =>
            reminderTemplate(ctx, { n: reminderNumber.get(entry.record.person) ?? 1 }),
        })),
      });

      let commitHash: string | null = null;
      if (delivery.sentPeople.length > 0) {
        const result = await fastify.storage.commit(
          "send",
          {
            actor: adminActor(request),
            subject: `send: reminders for ${slug} (${delivery.sentPeople.length} recipients)`,
            document: slug,
            requestId: request.requestId,
          },
          async (tx) => {
            const at = new Date().toISOString();
            for (const person of delivery.sentPeople) {
              const current = await tx.participations.queryFirst({ document: slug, person });
              if (!current) continue;
              const n = reminderNumber.get(person) ?? 1;
              await tx.participations.patch(
                { document: slug, person },
                { notified: { ...current.notified, reminder: n, [`reminder-${n}`]: at } },
              );
            }
          },
        );
        commitHash = result.commitHash;
      }

      return {
        dry_run: false,
        sent: delivery.sent,
        failed: delivery.failed,
        skipped_recent: skippedRecent,
        skipped_pref: skippedPref,
        min_age_hours: minAgeHours,
        failures: delivery.failures,
        commit: commitHash,
      };
    },
  );
};

export default invitationsRoute;
