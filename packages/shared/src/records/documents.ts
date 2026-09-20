import { z } from "zod";

/** `specs/data-model.md` → `documents`. Slugs are the stable identity. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;

export const DocumentStateSchema = z.enum(["draft", "open", "closed", "withdrawn"]);
export type DocumentState = z.infer<typeof DocumentStateSchema>;

export const CapacitySchema = z.enum(["personal", "official"]);
export type Capacity = z.infer<typeof CapacitySchema>;

export const PublicAccessSchema = z.enum(["none", "read", "participate"]);
export type PublicAccess = z.infer<typeof PublicAccessSchema>;

export const ShowSignatoriesSchema = z.enum(["list", "count", "none"]);
export type ShowSignatories = z.infer<typeof ShowSignatoriesSchema>;

/**
 * The `documents` sheet record. Frontmatter holds every field except `body`;
 * `body` is the markdown text and is the thing whose history is the version
 * history (see `packages/shared/src/records/index.ts` doc comment).
 */
export const DocumentRecordSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN),
  title: z.string().min(1),
  state: DocumentStateSchema,
  opened_at: z.iso.datetime().optional(),
  comments_close_at: z.iso.datetime().optional(),
  signing_closes_at: z.iso.datetime().optional(),
  // Defaults for these live in `.gitsheets/documents.toml`'s JSON Schema,
  // which validates (and fills defaults) *before* this Standard Schema layer
  // runs (see `references/sheet-config.md` → Validation behavior). Marking
  // them `.optional()` here — rather than `.default()` — keeps the inferred
  // TS type ergonomic for callers building an upsert (they may omit these),
  // since `Sheet<T>`'s `T` is this schema's *output* type, and a `.default()`
  // field is non-optional in a Zod output type.
  revocation_window_hours: z.number().int().optional(),
  capacities: z.array(CapacitySchema).optional(),
  public_access: PublicAccessSchema.optional(),
  show_signatories: ShowSignatoriesSchema.optional(),
  // `specs/behaviors/operators.md`: the operator who created the document,
  // always also present in `operators`. Optional here (not `.default()`)
  // because gitsheets "validation is on writes only" — a legacy record
  // read before the boot migration patches it in still parses. Every
  // record on disk after boot has both set; `POST /documents` always sets
  // them from the caller.
  created_by: z.email().optional(),
  operators: z.array(z.email()).optional(),
  sender_name: z.string().optional(),
  reply_to: z.string().optional(),
  withdraw_reason: z.string().optional(),
  withdraw_public: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  body: z.string(),
});

export type DocumentRecord = z.infer<typeof DocumentRecordSchema>;
