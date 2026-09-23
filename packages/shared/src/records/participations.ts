import { z } from "zod";

import { CapacitySchema, SLUG_PATTERN } from "./documents.ts";

/** `specs/data-model.md` → `participations`. */
export const ParticipationSourceSchema = z.enum(["crm", "admin", "public"]);
export type ParticipationSource = z.infer<typeof ParticipationSourceSchema>;

/**
 * `specs/behaviors/notifications.md` § Defaults: `my_comments_addressed`
 * and `reminders` are the only preferences. `every_revision`,
 * `daily_digest` and `phase_changes` were written by earlier builds; they
 * stay accepted here (and in the sheet schema) so those records remain
 * writable, and nothing reads them.
 */
export const NotifyPrefsSchema = z.object({
  channel: z.string().optional(),
  every_revision: z.boolean().optional(),
  daily_digest: z.boolean().optional(),
  phase_changes: z.boolean().optional(),
  my_comments_addressed: z.boolean().optional(),
  reminders: z.boolean().optional(),
});
export type NotifyPrefs = z.infer<typeof NotifyPrefsSchema>;

/** `notified.invitation`, `notified."disposition-v3"`, `notified."confirm-call-<ts>"`, `notified.reminder` — dynamic keys. */
export const NotifiedSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export type Notified = z.infer<typeof NotifiedSchema>;

/**
 * `specs/data-model.md` → `participations`: what **this document** prefills on
 * the sign card for this person, overriding the person's site-level defaults
 * field by field. Named for what it prefills — the `signature` table's own
 * fields — so `prefill.title` is the default for `signature.title` and stands
 * in for the person's `role`. Absent on every record written before it
 * existed, which resolves to the person's defaults alone.
 */
export const PrefillSchema = z.object({
  name: z.string().optional(),
  org: z.string().optional(),
  title: z.string().optional(),
  descriptor: z.string().optional(),
});
export type Prefill = z.infer<typeof PrefillSchema>;

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
  prefill: PrefillSchema.optional(),
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
