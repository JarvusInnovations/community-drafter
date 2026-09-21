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
 * `specs/data-model.md` § Audience. Who the **finished** statement is
 * published or delivered to. Stored on the document and orthogonal to
 * `public_access`, which is read access to the *working* document while it
 * is drafted — the two answer different questions and all four
 * combinations are meaningful.
 */
export const AudienceSchema = z.enum(["public", "closed"]);
export type Audience = z.infer<typeof AudienceSchema>;

/**
 * A record written before `audience` existed carries no value for it and
 * reads as `closed`: nothing is published for anyone to read until someone
 * says so (`specs/data-model.md` § Audience).
 */
export function audienceOf(document: { audience?: Audience }): Audience {
  return document.audience ?? "closed";
}

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
  // `specs/behaviors/sites.md`: the site this document belongs to. Absent
  // means the derived default site — which is what every document written
  // before the field existed reads as, so nothing needs migrating. It is
  // the hostname every personal link, public link and message for this
  // document is built on.
  site: z.string().regex(SLUG_PATTERN).optional(),
  // `specs/data-model.md` § Audience. `audience` is optional here for the
  // same reason it is optional in the sheet's JSON Schema: a record written
  // before the field existed still has to parse, and reads as `closed`.
  // `addressed_to` is required when the audience is `closed`, which the
  // admin API enforces — it is a rule about a pair of fields on a write,
  // not a shape a record on disk is held to.
  audience: AudienceSchema.optional(),
  addressed_to: z.array(z.string()).optional(),
  // `specs/behaviors/operators.md`: the operator who created the document,
  // always also present in `operators`. Optional here (not `.default()`)
  // because gitsheets "validation is on writes only" — a legacy record
  // read before the boot migration patches it in still parses. Every
  // record on disk after boot has both set; `POST /documents` always sets
  // them from the caller.
  created_by: z.email().optional(),
  operators: z.array(z.email()).optional(),
  /**
   * `specs/behaviors/notifications.md` § Operator digest: the operator
   * messages this document has already produced — `digest` = the last date
   * (`YYYY-MM-DD`, instance time zone) a digest was delivered,
   * `first_signature` / `first_comment` = when those once-per-document
   * notices went out. Optional for the same reason every other added field
   * is: a record written before it existed still has to parse.
   */
  operator_notified: z.record(z.string(), z.string()).optional(),
  sender_name: z.string().optional(),
  reply_to: z.string().optional(),
  withdraw_reason: z.string().optional(),
  withdraw_public: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  body: z.string(),
});

export type DocumentRecord = z.infer<typeof DocumentRecordSchema>;
