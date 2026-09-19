import type { FastifyInstance } from "fastify";

import { computeSignatories } from "./signatories.ts";
import { derivePhase } from "../phase/phase.ts";
import type { DocumentEntry } from "../storage/read-model.ts";

/**
 * `specs/api/admin.md`: "`GET /documents` → list with derived phase and
 * counts" / "`GET /documents/:slug` → document + versions + counts."
 * `specs/behaviors/signatures.md`: "the admin dashboard always shows all"
 * regardless of `show_signatories`, so this always computes the `list`
 * shape rather than honoring the document's own participant-facing setting.
 *
 * `commit`, when passed, is the hash of the write that produced this view —
 * `specs/api/admin-cli.md` § Output rules: "Every mutation prints the
 * resulting record's key fields and the commit subject" (the CLI's own
 * layer resolves the subject; this carries the hash it cites).
 */
export function documentSummary(
  fastify: FastifyInstance,
  entry: DocumentEntry,
  commit?: string | null,
) {
  const phase = derivePhase(entry.record, new Date());
  const participations = fastify.storage.readModel.listParticipationsForDocument(entry.record.slug);
  const signatories = computeSignatories(participations, "list") ?? {
    organizations: 0,
    individuals: 0,
    unlisted: 0,
  };
  const submissions = fastify.storage.readModel.listSubmissionsForDocument(entry.record.slug);
  const submitted = submissions.filter((s) => s.record.state === "submitted").length;
  const draft = submissions.filter((s) => s.record.state === "draft").length;

  return {
    slug: entry.record.slug,
    title: entry.record.title,
    state: entry.record.state,
    phase,
    opened_at: entry.record.opened_at,
    comments_close_at: entry.record.comments_close_at,
    signing_closes_at: entry.record.signing_closes_at,
    owner: entry.record.owner,
    sender_name: entry.record.sender_name,
    reply_to: entry.record.reply_to,
    capacities: entry.record.capacities,
    public_access: entry.record.public_access,
    show_signatories: entry.record.show_signatories,
    revocation_window_hours: entry.record.revocation_window_hours,
    tags: entry.record.tags,
    commit,
    counts: {
      versions: entry.versions.length,
      participations: participations.length,
      signatures: signatories,
      submissions: { submitted, draft },
    },
  };
}
