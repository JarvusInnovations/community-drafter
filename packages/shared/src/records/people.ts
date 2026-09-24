import { z } from "zod";

import { SLUG_PATTERN } from "./documents.ts";

/**
 * `specs/data-model.md` → `people`. Never rendered on any participant or
 * public surface beyond the resolved sign-card prefill.
 *
 * One record per person **per site** (`specs/behaviors/sites.md` § People are
 * per site): `site` is the first component of the record's path, `id` is
 * unique only within that site, and the same email on two sites is two
 * independent people. Every lookup is therefore scoped by the site of the
 * document in hand — a bare id is not an identity.
 */
export const PersonSourceSchema = z.enum(["crm", "public", "admin"]);
export type PersonSource = z.infer<typeof PersonSourceSchema>;

export const PersonRecordSchema = z.object({
  /** The site this person belongs to; `default` for the derived default site. */
  site: z.string().regex(SLUG_PATTERN),
  id: z.string().regex(SLUG_PATTERN),
  name: z.string().min(1),
  email: z.email(),
  phone: z.string().optional(),
  /** The site-level defaults for the sign card; a document may override each. */
  org: z.string().optional(),
  role: z.string().optional(),
  descriptor: z.string().optional(),
  source: PersonSourceSchema,
  external_id: z.string().optional(),
});

export type PersonRecord = z.infer<typeof PersonRecordSchema>;
