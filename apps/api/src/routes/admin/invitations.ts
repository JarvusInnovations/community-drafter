import type { Capacity, PersonRecord, Prefill } from "@signatories/shared";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

import { ApiError } from "../../errors.ts";
import { DOCUMENT_SCOPED_ROUTE } from "../../gateway/gateway.ts";
import { toCsv } from "../../lib/csv.ts";
import { lastMessagedAt, prefOn } from "../../lib/notify.ts";
import { participationStatus } from "../../lib/participation-status.ts";
import { prefillFromRow, resolvePrefill } from "../../lib/prefill.ts";
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

interface ImportQuery {
  dry_run?: string;
  update?: string;
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

/** The person fields an import row may carry, in the order they are reported. */
const PERSON_FIELDS = ["name", "phone", "org", "role", "descriptor", "external_id"] as const;
type PersonField = (typeof PERSON_FIELDS)[number];

interface PlanRow {
  email: string;
  name: string;
  person: string;
  action: "invite_new_person" | "invite_existing_person" | "skip_existing";
  would_change: string[];
  kept: string[];
  apply: {
    fields: Partial<Record<PersonField, string>>;
    prefill: Prefill | undefined;
    overwrites: number;
  };
}

function isTrue(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * `specs/api/admin.md` § People and invitations: "Without it, a row fills an
 * existing person's *blank* fields and keeps every value they already carry.
 * With `update=1`, the row's values replace them." `would_change` is what
 * this mode would really change, `kept` what it would leave alone, and
 * `overwrites` counts the already-set values a change replaces.
 */
function planPersonFields(
  row: ImportRow,
  existing: PersonRecord | null | undefined,
  update: boolean,
): {
  fields: Partial<Record<PersonField, string>>;
  would_change: string[];
  kept: string[];
  overwrites: number;
} {
  const fields: Partial<Record<PersonField, string>> = {};
  const would_change: string[] = [];
  const kept: string[] = [];
  let overwrites = 0;
  if (!existing) return { fields, would_change, kept, overwrites };

  for (const field of PERSON_FIELDS) {
    const next = present(row[field]);
    if (next === undefined) continue;
    const current = present(existing[field]);
    if (current === undefined) {
      fields[field] = next;
      would_change.push(field);
      continue;
    }
    if (current === next) continue;
    if (update) {
      fields[field] = next;
      would_change.push(field);
      overwrites += 1;
    } else {
      kept.push(field);
    }
  }
  return { fields, would_change, kept, overwrites };
}

const PREFILL_FIELDS = ["name", "org", "title", "descriptor"] as const;

/** Which of an existing participation's prefill fields this row would change. */
function changedPrefillFields(current: Prefill | undefined, next: Prefill | undefined): string[] {
  return PREFILL_FIELDS.filter(
    (key) => (current?.[key] ?? undefined) !== (next?.[key] ?? undefined),
  );
}

/**
 * An RFC 7396 merge patch that makes a participation's `prefill` exactly
 * `next`: a field the row no longer carries is deleted with `null`, which
 * the record type cannot express because it describes the merged result.
 */
function prefillPatch(next: Prefill | undefined): Prefill {
  return Object.fromEntries(
    PREFILL_FIELDS.map((key) => [key, next?.[key] ?? null]),
  ) as unknown as Prefill;
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

  fastify.post<{ Params: DocumentParams; Querystring: ImportQuery }>(
    "/documents/:slug/invitations/import",
    { config: DOCUMENT_SCOPED_ROUTE },
    async (request) => {
      const document = fastify.storage.readModel.getDocument(request.params.slug);
      if (!document) throw notFoundDocument(request.params.slug);
      const slug = document.record.slug;
      // `specs/behaviors/sites.md` § People are per site: the merge key is
      // the email **within the document's site**. The same address on
      // another site is a different person and is never read or written.
      const site = fastify.storage.readModel.siteSlugForDocument(slug);
      const rows = parseImportRows(request);
      const dryRun = isTrue(request.query?.dry_run);
      const update = isTrue(request.query?.update);

      // `specs/api/admin.md` § People and invitations: the plan is computed
      // read-only first, so a dry run reports exactly what the commit below
      // would do — including which existing person fields a row would
      // change and which it would keep.
      const plan: PlanRow[] = [];
      const plannedIds = new Set<string>();
      for (const row of rows) {
        const email = row.email.trim();
        const existing = await fastify.storage.store.people.queryFirst({
          site,
          email: (value) => value.toLowerCase() === email.toLowerCase(),
        });
        const personId =
          existing?.id ??
          uniqueSlug(
            row.name,
            (candidate) =>
              plannedIds.has(candidate) ||
              Boolean(fastify.storage.readModel.getPerson(site, candidate)),
          );
        if (!existing) plannedIds.add(personId);

        const { fields, would_change, kept, overwrites } = planPersonFields(row, existing, update);
        const participation = fastify.storage.readModel.getParticipation(slug, personId);
        const prefill = prefillFromRow(row);
        // An already-invited person's participation is left alone unless the
        // file is declared authoritative: `--update` is what lets it refresh
        // the prefill this document shows.
        const prefillChanges =
          participation && update
            ? changedPrefillFields(participation.record.prefill, prefill)
            : [];

        plan.push({
          email,
          name: row.name,
          person: personId,
          action: participation
            ? "skip_existing"
            : existing
              ? "invite_existing_person"
              : "invite_new_person",
          would_change: [...would_change, ...prefillChanges.map((field) => `prefill.${field}`)],
          kept,
          // Not part of the response — the write pass reads it so the plan
          // and the commit can never disagree about what changes.
          apply: { fields, prefill, overwrites },
        });
      }

      const counts = {
        update,
        site,
        people_created: plan.filter((p) => p.action === "invite_new_person").length,
        people_updated: plan.filter(
          (p) => p.action !== "invite_new_person" && Object.keys(p.apply.fields).length > 0,
        ).length,
        people_overwritten: plan.filter((p) => p.apply.overwrites > 0).length,
        invitations_created: plan.filter((p) => p.action !== "skip_existing").length,
        skipped_existing: plan.filter((p) => p.action === "skip_existing").length,
      };
      const planRows = plan.map(({ apply: _apply, ...row }) => row);
      if (dryRun) {
        return { dry_run: true, ...counts, rows: planRows, commit: null };
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
          const mintedTokens = new Set<string>();
          for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index]!;
            const planned = plan[index]!;
            const email = row.email.trim();
            const existing = await tx.people.queryFirst({
              site,
              email: (value) => value.toLowerCase() === email.toLowerCase(),
            });

            if (existing) {
              // Only the fields the plan named — an unnamed field keeps the
              // value the person already carries.
              if (Object.keys(planned.apply.fields).length > 0) {
                await tx.people.patch({ site, id: existing.id }, planned.apply.fields);
              }
            } else {
              await tx.people.upsert({
                site,
                id: planned.person,
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
              person: planned.person,
            });
            if (existingParticipation) {
              if (update && planned.would_change.some((field) => field.startsWith("prefill."))) {
                await tx.participations.patch(
                  { document: slug, person: planned.person },
                  { prefill: prefillPatch(planned.apply.prefill) },
                );
              }
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
              person: planned.person,
              token,
              source: "crm",
              suggested_capacity: row.suggested_capacity,
              // `specs/data-model.md` → `participations`: the row's sign-card
              // values belong to *this* document, not to the person.
              prefill: planned.apply.prefill,
            });
          }
        },
      );

      return { ...counts, rows: planRows, commit: result.commitHash };
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
        const person = fastify.storage.readModel.getPersonOn(slug, entry.record.person);
        // `specs/api/admin.md`: a row's `name` and `org` are what **this**
        // document prefills, so the list, "view as" and the sign card agree.
        const prefill = resolvePrefill(person, entry.record);
        return {
          person: entry.record.person,
          name: prefill.name ?? "",
          org: prefill.org ?? "",
          prefill,
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
        const personRecord = fastify.storage.readModel.getPersonOn(slug, entry.record.person);
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
              fastify.storage.readModel.getPersonOn(slug, entry.record.person)?.name ??
              entry.record.person,
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
            const personRecord = fastify.storage.readModel.getPersonOn(slug, entry.record.person);
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
        const personRecord = fastify.storage.readModel.getPersonOn(slug, entry.record.person);
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
