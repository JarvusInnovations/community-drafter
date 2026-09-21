import { audienceOf } from "@signatories/shared";
import type { FastifyInstance } from "fastify";

import { computeSignatories } from "./signatories.ts";
import { isSignatureBehind } from "./signature-view.ts";
import { derivePhase } from "../phase/phase.ts";
import { documentSiteSlug, siteForDocument } from "../sites/site.ts";
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
  // `specs/api/admin.md`: the signature counts carry `behind` — live
  // signatures attached to a version older than the current one, the number
  // the team needs before marking anything final (`specs/screens/admin-dashboard.md`).
  const behind = participations.filter((p) => isSignatureBehind(p, entry.versions.length)).length;
  const submissions = fastify.storage.readModel.listSubmissionsForDocument(entry.record.slug);
  const submitted = submissions.filter((s) => s.record.state === "submitted").length;
  const draft = submissions.filter((s) => s.record.state === "draft").length;

  const site = siteForDocument(fastify, entry.record);

  return {
    slug: entry.record.slug,
    title: entry.record.title,
    // `specs/api/admin.md`: every document shape carries its site — the
    // slug (`default` for a document that names none) and the origin its
    // personal and public links are built on, so an operator reads the
    // address their participants will actually receive rather than
    // assembling it from the URL they happen to be signed in to.
    site: documentSiteSlug(entry.record),
    site_url: site.baseUrl,
    state: entry.record.state,
    phase,
    opened_at: entry.record.opened_at,
    comments_close_at: entry.record.comments_close_at,
    signing_closes_at: entry.record.signing_closes_at,
    created_by: entry.record.created_by,
    operators: entry.record.operators,
    sender_name: entry.record.sender_name,
    reply_to: entry.record.reply_to,
    capacities: entry.record.capacities,
    // `specs/api/admin.md`: every document shape carries `audience` and
    // `addressed_to` as stored, beside `public_access`; nothing is derived
    // from anything. A record written before `audience` existed reads
    // `closed` (`specs/data-model.md` § Audience).
    public_access: entry.record.public_access,
    audience: audienceOf(entry.record),
    addressed_to: entry.record.addressed_to,
    show_signatories: entry.record.show_signatories,
    revocation_window_hours: entry.record.revocation_window_hours,
    tags: entry.record.tags,
    commit,
    counts: {
      versions: entry.versions.length,
      participations: participations.length,
      signatures: { ...signatories, behind },
      submissions: { submitted, draft },
    },
  };
}
