import type { ParticipationRecord, PersonRecord, Prefill } from "@signatories/shared";

/**
 * The sign card's values for one person on one document.
 *
 * `specs/data-model.md` § A person belongs to a site; a per-document prefill
 * belongs to the participation — each field resolves in one direction and the
 * two are never merged into a third thing:
 *
 *   1. the participation's `prefill` value for that field, if it has one;
 *   2. else the person's site-level default;
 *   3. else nothing — an empty box the signer fills in.
 *
 * The one naming seam is deliberate and lives here: the participation's field
 * is named for what it prefills (`signature.title`), the person's for what it
 * is (a standing `role`), and the wire keeps `role`
 * (`specs/api/participant.md`).
 */
export interface ResolvedPrefill {
  name?: string;
  org?: string;
  role?: string;
  descriptor?: string;
}

function pick(override: string | undefined, fallback: string | undefined): string | undefined {
  return override !== undefined && override !== "" ? override : fallback;
}

export function resolvePrefill(
  person: Pick<PersonRecord, "name" | "org" | "role" | "descriptor"> | undefined,
  participation: Pick<ParticipationRecord, "prefill"> | undefined,
): ResolvedPrefill {
  const prefill: Prefill = participation?.prefill ?? {};
  return {
    name: pick(prefill.name, person?.name),
    org: pick(prefill.org, person?.org),
    role: pick(prefill.title, person?.role),
    descriptor: pick(prefill.descriptor, person?.descriptor),
  };
}

/** The four sign-card fields an import row carries, as a participation `prefill`. */
export function prefillFromRow(row: {
  name?: string;
  org?: string;
  role?: string;
  descriptor?: string;
}): Prefill | undefined {
  const prefill: Prefill = {};
  if (row.name) prefill.name = row.name;
  if (row.org) prefill.org = row.org;
  if (row.role) prefill.title = row.role;
  if (row.descriptor) prefill.descriptor = row.descriptor;
  return Object.keys(prefill).length > 0 ? prefill : undefined;
}
