import type { ShowSignatories } from "@signatories/shared";

import type { ParticipationEntry, SignatureEvent } from "../storage/read-model.ts";

/** `specs/api/participant.md` bundle shape → `signatories.list[]`. */
export interface SignatoryListItem {
  display_name: string;
  capacity: "personal" | "official";
  descriptor?: string;
  org?: string;
  title?: string;
}

export interface SignatorySummary {
  organizations: number;
  individuals: number;
  unlisted: number;
  list?: SignatoryListItem[];
  /**
   * The most recent sign/resign event among current signatories, ISO 8601 —
   * the "last updated" time `specs/screens/public-and-embed.md`'s
   * signatories page/fragment shows. `undefined` when nobody has signed yet.
   */
  updated_at?: string;
}

/**
 * `specs/behaviors/signatures.md` § Display: "current signatory = present,
 * `revoked = false`, `display_approved = true`." Phase 1 never creates a
 * signature with `display_approved` anything but `true` (the `public`
 * source that starts `false` is `[phase 2]`), but the check is written
 * against the field itself rather than assumed, so the day that lands this
 * function needs no change.
 */
function isCurrentSignatory(entry: ParticipationEntry): boolean {
  const signature = entry.record.signature;
  if (!signature) return false;
  if (signature.revoked) return false;
  return signature.display_approved === true;
}

/**
 * The date a current signature "took effect": the most recent `sign` or
 * `resign` event. Because the record is currently unrevoked, the latest
 * event touching it must be one of these two (a `revoke` would have left
 * `revoked = true`). Re-signing after a revocation resets a signer's place
 * in the chronological order — "reward early signers" cares about momentum
 * under the *current* signature, not a since-reversed earlier one.
 */
function effectiveSignedAt(events: SignatureEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && (event.action === "sign" || event.action === "resign")) return event.at;
  }
  return "";
}

/** The latest `effectiveSignedAt` among a set of current signatories, or `""` if none. */
function latestEffectiveSignedAt(entries: ParticipationEntry[]): string {
  let latest = "";
  for (const entry of entries) {
    const at = effectiveSignedAt(entry.signatureEvents);
    if (at > latest) latest = at;
  }
  return latest;
}

/**
 * `specs/behaviors/signatures.md` § Display + `specs/api/participant.md`
 * bundle `signatories` field. `show_signatories = none` → `null`;
 * `= count` → counts only; `= list` → counts plus the ordered, unlisted-
 * filtered list.
 *
 * An unlisted signer is counted **once**: they are "counted but not named"
 * by `unlisted`, and excluded from `organizations` and `individuals`, so the
 * three figures in a counts line never overlap (issue #68 — the sentence
 * read "3 individuals, and 1 other who asked not to be listed" above two
 * names).
 */
export function computeSignatories(
  participations: ParticipationEntry[],
  showSignatories: ShowSignatories,
): SignatorySummary | null {
  if (showSignatories === "none") return null;

  const current = participations.filter(isCurrentSignatory);

  const isListed = (entry: ParticipationEntry): boolean => entry.record.signature?.listed !== false;

  const officials = current.filter((entry) => entry.record.signature?.capacity === "official");
  const personals = current.filter((entry) => entry.record.signature?.capacity === "personal");

  const listedOfficials = officials.filter(isListed);
  const listedPersonals = personals.filter(isListed);

  const orgs = new Set(listedOfficials.map((entry) => entry.record.signature?.org ?? ""));
  const unlisted = current.length - listedOfficials.length - listedPersonals.length;

  const summary: SignatorySummary = {
    organizations: orgs.size,
    individuals: listedPersonals.length,
    unlisted,
    updated_at: latestEffectiveSignedAt(current) || undefined,
  };

  if (showSignatories !== "list") return summary;

  const orderedOfficials = [...listedOfficials].sort((a, b) =>
    (a.record.signature?.org ?? "").localeCompare(b.record.signature?.org ?? ""),
  );

  const orderedPersonals = [...listedPersonals].sort((a, b) =>
    effectiveSignedAt(a.signatureEvents).localeCompare(effectiveSignedAt(b.signatureEvents)),
  );

  summary.list = [...orderedOfficials, ...orderedPersonals].map((entry) => {
    const signature = entry.record.signature;
    return {
      display_name: signature?.display_name ?? "",
      capacity: signature?.capacity ?? "personal",
      descriptor: signature?.descriptor,
      org: signature?.org,
      title: signature?.title,
    };
  });

  return summary;
}
