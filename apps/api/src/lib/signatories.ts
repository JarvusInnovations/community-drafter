import type { ShowSignatories } from "@community-drafter/shared";

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
 * filtered list. Counts always include `listed = false` signers (they are
 * "counted but not named"); only the `list` array excludes them.
 */
export function computeSignatories(
  participations: ParticipationEntry[],
  showSignatories: ShowSignatories,
): SignatorySummary | null {
  if (showSignatories === "none") return null;

  const current = participations.filter(isCurrentSignatory);

  const officials = current.filter((entry) => entry.record.signature?.capacity === "official");
  const personals = current.filter((entry) => entry.record.signature?.capacity === "personal");

  const orgs = new Set(officials.map((entry) => entry.record.signature?.org ?? ""));
  const unlisted = current.filter((entry) => entry.record.signature?.listed === false).length;

  const summary: SignatorySummary = {
    organizations: orgs.size,
    individuals: personals.length,
    unlisted,
    updated_at: latestEffectiveSignedAt(current) || undefined,
  };

  if (showSignatories !== "list") return summary;

  const listedOfficials = officials
    .filter((entry) => entry.record.signature?.listed !== false)
    .sort((a, b) => (a.record.signature?.org ?? "").localeCompare(b.record.signature?.org ?? ""));

  const listedPersonals = personals
    .filter((entry) => entry.record.signature?.listed !== false)
    .sort((a, b) =>
      effectiveSignedAt(a.signatureEvents).localeCompare(effectiveSignedAt(b.signatureEvents)),
    );

  summary.list = [...listedOfficials, ...listedPersonals].map((entry) => {
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
