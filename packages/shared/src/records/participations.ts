import { z } from "zod";

import { CapacitySchema, SLUG_PATTERN } from "./documents.ts";

/** `specs/data-model.md` → `participations`. */
export const ParticipationSourceSchema = z.enum(["crm", "admin", "public"]);
export type ParticipationSource = z.infer<typeof ParticipationSourceSchema>;

export const NotifyPrefsSchema = z.object({
  channel: z.string().optional(),
  every_revision: z.boolean().optional(),
  daily_digest: z.boolean().optional(),
  phase_changes: z.boolean().optional(),
  my_comments_addressed: z.boolean().optional(),
  reminders: z.boolean().optional(),
});
export type NotifyPrefs = z.infer<typeof NotifyPrefsSchema>;

/** `notified.v3`, `notified.signing-opened`, `notified.digest`, `notified.reminder` — dynamic keys. */
export const NotifiedSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export type Notified = z.infer<typeof NotifiedSchema>;

export const SignatureSchema = z.object({
  capacity: CapacitySchema,
  display_name: z.string(),
  descriptor: z.string().optional(),
  org: z.string().optional(),
  title: z.string().optional(),
  authorized: z.boolean(),
  conditional: z.boolean().optional(),
  // Default (`true`) lives in `.gitsheets/participations.toml`'s JSON
  // Schema; `.optional()` here keeps the inferred TS type ergonomic (see
  // the equivalent note in `documents.ts`).
  listed: z.boolean().optional(),
  display_approved: z.boolean().optional(),
  signed_on_version: z.number().int().optional(),
  revoked: z.boolean().optional(),
});
export type Signature = z.infer<typeof SignatureSchema>;

/**
 * One person's relationship to one document. `token` is the personal-link
 * credential (never logged past the first four characters, per CLAUDE.md).
 * Sign/revoke/resign dates are not fields here — they come from `git log`
 * on the `sign` / `revoke` / `resign` / `admin-revoke` commits touching this
 * record (see `apps/api/src/storage/read-model.ts`).
 */
export const ParticipationRecordSchema = z.object({
  document: z.string().regex(SLUG_PATTERN),
  person: z.string().regex(SLUG_PATTERN),
  token: z.string().min(16),
  source: ParticipationSourceSchema,
  suggested_capacity: CapacitySchema.optional(),
  // Defaults (`false` / `0`) live in `.gitsheets/participations.toml`'s
  // JSON Schema; see the note on `documents.ts`'s equivalent fields.
  link_revoked: z.boolean().optional(),
  expires_at: z.iso.datetime().optional(),
  sent_at: z.iso.datetime().optional(),
  first_opened_at: z.iso.datetime().optional(),
  last_seen_at: z.iso.datetime().optional(),
  opens: z.number().int().min(0).optional(),
  notify: NotifyPrefsSchema.optional(),
  notified: NotifiedSchema.optional(),
  signature: SignatureSchema.optional(),
});

export type ParticipationRecord = z.infer<typeof ParticipationRecordSchema>;
