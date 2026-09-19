import { z } from "zod";

import { SLUG_PATTERN } from "./documents.ts";

/** `specs/data-model.md` → `people`. Never rendered on any participant/public surface. */
export const PersonSourceSchema = z.enum(["crm", "public", "admin"]);
export type PersonSource = z.infer<typeof PersonSourceSchema>;

export const PersonRecordSchema = z.object({
  id: z.string().regex(SLUG_PATTERN),
  name: z.string().min(1),
  email: z.email(),
  phone: z.string().optional(),
  org: z.string().optional(),
  role: z.string().optional(),
  descriptor: z.string().optional(),
  source: PersonSourceSchema,
  external_id: z.string().optional(),
});

export type PersonRecord = z.infer<typeof PersonRecordSchema>;
