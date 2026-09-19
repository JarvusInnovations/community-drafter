import type { Capacity } from "@community-drafter/shared";

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
    signed_on_version: signature.signed_on_version,
    revoked: signature.revoked ?? false,
    signed_at: firstSign?.at,
    revoked_at: signature.revoked ? lastRevoke?.at : undefined,
    resigned_at: lastResign?.at,
  };
}
