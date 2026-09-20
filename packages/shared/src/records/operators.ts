import { z } from "zod";

import { SLUG_PATTERN } from "./documents.ts";

/**
 * `specs/data-model.md` → `operators`. One record per person or bot allowed
 * to run documents (`specs/behaviors/operators.md`). Managed only through
 * the admin API and CLI, so the service stays the single writer.
 */
export const OperatorKindSchema = z.enum(["person", "bot"]);
export type OperatorKind = z.infer<typeof OperatorKindSchema>;

export const OperatorRecordSchema = z.object({
  id: z.string().regex(SLUG_PATTERN),
  email: z.email(),
  name: z.string().min(1),
  kind: OperatorKindSchema,
  active: z.boolean(),
  title: z.string().optional(),
  org: z.string().optional(),
  notes: z.string().optional(),
});

export type OperatorRecord = z.infer<typeof OperatorRecordSchema>;
