import type { Capacity } from "@signatories/shared";

import type { ParticipationEntry } from "../storage/read-model.ts";

/**
 * `specs/api/participant.md` bundle shape → `signature`. Sign/revoke/resign
 * dates are never fields (`specs/data-model.md`); they're read back from
 * `signatureEvents`, the read model's per-participation history of
 * `sign`/`resign`/`revoke`/`admin-revoke` commits.
 */
export interface SignatureView {
  capacity: Capacity;
  display_name: string;
  descriptor?: string;
  org?: string;
  title?: string;
  conditional: boolean;
  listed: boolean;
  signed_on_version?: number;
  revoked: boolean;
  signed_at?: string;
  revoked_at?: string;
  resigned_at?: string;
}

/**
 * The version a signature is attached to (`specs/behaviors/signatures.md` §
 * A signature belongs to a version). Normally the stored field; on a record
 * written before that field existed it is read back from the `Version`
 * trailer of the commit that put the signature currently in force — the
 * latest `sign` or `resign` event carrying one. Read-only: nothing rewrites
 * those records.
 */
export function effectiveSignedVersion(entry: ParticipationEntry): number | undefined {
  const stored = entry.record.signature?.signed_on_version;
  if (stored !== undefined) return stored;
  return [...entry.signatureEvents]
    .reverse()
    .find(
      (event) =>
        (event.action === "sign" || event.action === "resign") && event.version !== undefined,
    )?.version;
}

/**
 * A live signature attached to a version older than the document's current
 * one — "behind". A revoked signature is never behind: it is not a
 * signature any more.
 */
export function isSignatureBehind(entry: ParticipationEntry, currentVersion: number): boolean {
  const signature = entry.record.signature;
  if (!signature || signature.revoked === true) return false;
  const version = effectiveSignedVersion(entry);
  return version !== undefined && version < currentVersion;
}

export function buildSignatureView(entry: ParticipationEntry): SignatureView | null {
  const signature = entry.record.signature;
  if (!signature) return null;

  const events = entry.signatureEvents;
  const firstSign = events.find((event) => event.action === "sign");
  const lastRevoke = [...events]
    .reverse()
    .find((event) => event.action === "revoke" || event.action === "admin-revoke");
  const lastResign = [...events].reverse().find((event) => event.action === "resign");

  return {
    capacity: signature.capacity,
    display_name: signature.display_name,
    descriptor: signature.descriptor,
    org: signature.org,
    title: signature.title,
    conditional: signature.conditional ?? false,
    listed: signature.listed ?? true,
    signed_on_version: effectiveSignedVersion(entry),
    revoked: signature.revoked ?? false,
    signed_at: firstSign?.at,
    revoked_at: signature.revoked ? lastRevoke?.at : undefined,
    resigned_at: lastResign?.at,
  };
}
