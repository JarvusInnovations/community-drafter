import type { DocumentRecord } from "@signatories/shared";
import { parseDeadlinesTrailer } from "@signatories/shared";
import type { FastifyInstance } from "fastify";

import { computeSignatories } from "../lib/signatories.ts";
import type { Actor } from "../storage/actor.ts";
import type { DocumentEntry } from "../storage/read-model.ts";
import { clockLine, formatWhen } from "./format.ts";
import { sendToDocumentOperators } from "./operator-mail.ts";
import { derivePhase } from "../phase/phase.ts";

/**
 * `specs/behaviors/notifications.md` § Operator digest — the messages that
 * tell a document's own operators what is happening on it. Issue #74: four
 * signatures, an opt-out and two participant actions produced no message to
 * the team running the document, and the dashboard was the only signal.
 *
 * Three messages, all of them operator mail (§ Operator mail: never
 * preference-gated, nothing written to any participation, delivery logged
 * rather than parked in the dispatcher's retry bucket):
 *
 * - `operator-digest-<date>`, daily at the instance digest hour, and only
 *   when something actually happened;
 * - `operator-first-signature` and `operator-first-comment`, once each per
 *   document, the moment they happen.
 */

const DIGEST_ACTOR: Actor = { kind: "system" };

/**
 * Two people signing within the same instant would both read an unset
 * `first_signature` off the read model and both send. The record is the
 * durable guard; this is the one that covers the window between the check
 * and the commit.
 */
const inFlight = new Set<string>();

/** Where a fact came from decides how it is counted — see `collectOperatorDigest`. */
export interface OperatorDigestSummary {
  invitationsDelivered: number;
  firstOpens: number;
  reviews: { count: number; names: string[] };
  signaturesAdded: { count: number; names: string[] };
  signaturesRemoved: { count: number; names: string[] };
  declines: number;
  deadlines: string[];
  signatories: { organizations: number; individuals: number; unlisted: number };
}

/**
 * How a person is named in operator mail: the way they are listed if they
 * signed, else the name on the record. Never an email, never anything else
 * from `people` (§ Operator digest, "What no operator message carries").
 */
export function operatorFacingName(
  fastify: FastifyInstance,
  document: string,
  person: string,
): string {
  const participation = fastify.storage.readModel.getParticipation(document, person);
  const signed = participation?.record.signature?.display_name;
  if (signed) return signed;
  return fastify.storage.readModel.getPerson(person)?.name || person;
}

function unique(names: string[]): string[] {
  return [...new Set(names)];
}

function isEmpty(summary: OperatorDigestSummary): boolean {
  return (
    summary.invitationsDelivered === 0 &&
    summary.firstOpens === 0 &&
    summary.reviews.count === 0 &&
    summary.signaturesAdded.count === 0 &&
    summary.signaturesRemoved.count === 0 &&
    summary.declines === 0 &&
    summary.deadlines.length === 0
  );
}

/**
 * Everything that happened on one document in a window, or `null` when
 * nothing did — a digest that arrives every morning saying nothing happened
 * is the one an operator stops opening.
 *
 * Invitations delivered and first opens are counted from the participation
 * records, whose `sent_at` and `first_opened_at` are written only on the
 * event they name; everything else is read from the document's commits,
 * which is the only place those times exist at all (§ Operator digest,
 * "Where those facts come from").
 */
export function collectOperatorDigest(
  fastify: FastifyInstance,
  document: DocumentEntry,
  sinceIso: string,
  now: Date = new Date(),
): OperatorDigestSummary | null {
  const slug = document.record.slug;
  const since = new Date(sinceIso).getTime();
  const within = (iso: string | undefined): boolean =>
    iso !== undefined && new Date(iso).getTime() >= since;

  const participations = fastify.storage.readModel.listParticipationsForDocument(slug);
  const timezone = fastify.config.INSTANCE_TIMEZONE || "UTC";

  const summary: OperatorDigestSummary = {
    invitationsDelivered: participations.filter((entry) => within(entry.record.sent_at)).length,
    firstOpens: participations.filter((entry) => within(entry.record.first_opened_at)).length,
    reviews: { count: 0, names: [] },
    signaturesAdded: { count: 0, names: [] },
    signaturesRemoved: { count: 0, names: [] },
    declines: 0,
    deadlines: [],
    signatories: computeSignatories(participations, "count") ?? {
      organizations: 0,
      individuals: 0,
      unlisted: 0,
    },
  };

  for (const entry of fastify.storage.readModel.listActivitySince(slug, sinceIso)) {
    const person = entry.trailers.Person;
    const name = person ? operatorFacingName(fastify, slug, person) : undefined;

    switch (entry.action) {
      case "submit": {
        if (entry.trailers.Judgement === "decline") {
          summary.declines += 1;
        } else {
          summary.reviews.count += 1;
          if (name) summary.reviews.names.push(name);
        }
        // Comment mode signs in the same commit as it submits
        // (`specs/data-model.md` → `Signature` trailer), so that signature
        // is this commit's too.
        if (entry.trailers.Signature === "revoke") {
          summary.signaturesRemoved.count += 1;
          if (name) summary.signaturesRemoved.names.push(name);
        } else if (entry.trailers.Signature) {
          summary.signaturesAdded.count += 1;
          if (name) summary.signaturesAdded.names.push(name);
        }
        break;
      }
      case "sign":
      case "resign": {
        summary.signaturesAdded.count += 1;
        if (name) summary.signaturesAdded.names.push(name);
        break;
      }
      case "revoke":
      case "admin-revoke": {
        summary.signaturesRemoved.count += 1;
        if (name) summary.signaturesRemoved.names.push(name);
        break;
      }
      case "extend":
      case "reopen": {
        for (const change of parseDeadlinesTrailer(entry.trailers.Deadlines ?? "")) {
          const to = formatWhen(change.to, timezone, now);
          if (!to) continue;
          const from = formatWhen(change.from, timezone, now);
          const label =
            change.deadline === "comments_close_at" ? "Comments close" : "Signatures are due";
          summary.deadlines.push(from ? `${label}: ${from} → ${to}` : `${label}: ${to}`);
        }
        break;
      }
      default:
        break;
    }
  }

  summary.reviews.names = unique(summary.reviews.names);
  summary.signaturesAdded.names = unique(summary.signaturesAdded.names);
  summary.signaturesRemoved.names = unique(summary.signaturesRemoved.names);

  return isEmpty(summary) ? null : summary;
}

function withNames(count: number, singular: string, plural: string, names: string[]): string {
  const noun = count === 1 ? singular : plural;
  return names.length > 0 ? `- ${count} ${noun}: ${names.join(", ")}` : `- ${count} ${noun}`;
}

/** One line per kind of thing that happened; a kind with nothing in it has no line. */
export function operatorDigestBody(
  document: DocumentRecord,
  summary: OperatorDigestSummary,
  clock: string | undefined,
): string[] {
  const body = [`Here's what happened on "${document.title}" in the last 24 hours:`];

  if (summary.invitationsDelivered > 0) {
    body.push(
      `- ${summary.invitationsDelivered} invitation${summary.invitationsDelivered === 1 ? "" : "s"} delivered`,
    );
  }
  if (summary.firstOpens > 0) {
    body.push(
      `- ${summary.firstOpens} ${summary.firstOpens === 1 ? "person" : "people"} opened the document for the first time`,
    );
  }
  if (summary.reviews.count > 0) {
    body.push(
      withNames(
        summary.reviews.count,
        "review submitted",
        "reviews submitted",
        summary.reviews.names,
      ),
    );
  }
  if (summary.signaturesAdded.count > 0) {
    body.push(
      withNames(
        summary.signaturesAdded.count,
        "signature added",
        "signatures added",
        summary.signaturesAdded.names,
      ),
    );
  }
  if (summary.signaturesRemoved.count > 0) {
    body.push(
      withNames(
        summary.signaturesRemoved.count,
        "signature removed",
        "signatures removed",
        summary.signaturesRemoved.names,
      ),
    );
  }
  if (summary.declines > 0) {
    body.push(`- ${summary.declines} decline${summary.declines === 1 ? "" : "s"}`);
  }
  for (const deadline of summary.deadlines) body.push(`- Deadline moved — ${deadline}`);

  const unlisted =
    summary.signatories.unlisted > 0 ? ` (${summary.signatories.unlisted} unlisted)` : "";
  body.push(
    `${summary.signatories.organizations} organizations and ${summary.signatories.individuals} individuals have signed so far${unlisted}.`,
  );
  if (clock) body.push(clock);
  return body;
}

/**
 * `specs/behaviors/notifications.md` § Operator digest, "What is recorded":
 * one `Action: send` commit on the document, written **after** at least one
 * operator message was accepted — a run whose sends all failed is not
 * recorded as sent, and the next one tries again.
 */
async function recordOperatorNotified(
  fastify: FastifyInstance,
  slug: string,
  key: string,
  value: string,
): Promise<void> {
  await fastify.storage.commit(
    "send",
    {
      actor: DIGEST_ACTOR,
      subject: `send: ${key} operator mail for ${slug}`,
      document: slug,
    },
    async (tx) => {
      const current = await tx.documents.queryFirst({ slug });
      if (!current) return;
      await tx.documents.patch(
        { slug },
        { operator_notified: { ...current.operator_notified, [key]: value } },
      );
    },
  );
}

/** Whether this once-per-document (or once-per-day) message has already gone out. */
function alreadySent(document: DocumentRecord, key: string, day?: string): boolean {
  const current = document.operator_notified?.[key];
  if (current === undefined) return false;
  return day === undefined || current === day;
}

/** The digest for one document on one day. Sends and records nothing on a quiet day. */
export async function sendOperatorDigest(
  fastify: FastifyInstance,
  document: DocumentEntry,
  today: string,
  sinceIso: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (alreadySent(document.record, "digest", today)) return false;

  const summary = collectOperatorDigest(fastify, document, sinceIso, now);
  if (!summary) return false;

  const timezone = fastify.config.INSTANCE_TIMEZONE || "UTC";
  const clock = clockLine(
    derivePhase(document.record, now),
    document.record.comments_close_at,
    document.record.signing_closes_at,
    timezone,
    now,
  );

  const { delivered } = await sendToDocumentOperators(fastify, {
    eventKey: `operator-digest-${today}`,
    document: document.record,
    subject: `${document.record.title} — today's activity`,
    body: operatorDigestBody(document.record, summary, clock),
  });

  if (delivered === 0) return false;
  await recordOperatorNotified(fastify, document.record.slug, "digest", today);
  return true;
}

/**
 * `operator-first-signature` / `operator-first-comment` — the first response
 * is the thing a team is waiting for after it sends a document out, and a
 * day is a long time to wonder whether the link even works. Once each per
 * document, whatever the digest reports later the same day.
 */
export async function sendFirstResponseNotice(
  fastify: FastifyInstance,
  slug: string,
  kind: "first_signature" | "first_comment",
  person: string,
): Promise<boolean> {
  const document = fastify.storage.readModel.getDocument(slug);
  if (!document) return false;
  if (alreadySent(document.record, kind)) return false;

  const guard = `${slug}:${kind}`;
  if (inFlight.has(guard)) return false;
  inFlight.add(guard);
  try {
    return await deliverFirstResponseNotice(fastify, document, kind, person);
  } finally {
    inFlight.delete(guard);
  }
}

async function deliverFirstResponseNotice(
  fastify: FastifyInstance,
  document: DocumentEntry,
  kind: "first_signature" | "first_comment",
  person: string,
): Promise<boolean> {
  const slug = document.record.slug;
  const who = operatorFacingName(fastify, slug, person);
  const title = document.record.title;
  const [subject, sentence] =
    kind === "first_signature"
      ? [`${title} — first signature`, `${who} is the first person to sign "${title}".`]
      : [`${title} — first comments`, `${who} is the first person to comment on "${title}".`];

  const { delivered } = await sendToDocumentOperators(fastify, {
    eventKey: kind === "first_signature" ? "operator-first-signature" : "operator-first-comment",
    document: document.record,
    subject,
    body: [sentence, "The dashboard has the rest as it arrives."],
  });

  if (delivered === 0) return false;
  await recordOperatorNotified(fastify, slug, kind, new Date().toISOString());
  return true;
}
