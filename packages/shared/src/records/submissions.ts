import { z } from "zod";

import { SLUG_PATTERN } from "./documents.ts";
import { JUDGEMENTS } from "./trailers.ts";

/**
 * `specs/data-model.md` → `submissions`. The anchor shape is
 * `specs/behaviors/inline-comments.md` — the same shape the `render-and-diff`
 * plan's `../anchor/types.ts` `Anchor` interface models for computation and
 * re-anchoring. This schema is the write-time validator for that shape as
 * stored on a comment; it deliberately does not re-export a type named
 * `Anchor` (that name belongs to `../anchor/index.ts`, to avoid a barrel
 * collision), but `z.infer<typeof AnchorSchema>` is structurally identical.
 */
export const SUBMISSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}-[A-Za-z0-9]{4}$/;
export const COMMENT_ID_PATTERN = /^c[0-9]+$/;

export const JudgementSchema = z.enum(JUDGEMENTS);

export const DispositionSchema = z.enum(["accepted", "partial", "declined", "noted"]);
export type Disposition = z.infer<typeof DispositionSchema>;

export const AnchorSchema = z.object({
  version: z.number().int(),
  commit: z.string(),
  block: z.string(),
  heading_path: z.array(z.string()),
  quote: z.string().min(3).max(1000),
  prefix: z.string().max(40),
  suffix: z.string().max(40),
  start: z.number().int().min(0),
  spans_blocks: z.boolean().optional(),
});

export const CommentSchema = z.object({
  id: z.string().regex(COMMENT_ID_PATTERN),
  anchor: AnchorSchema.optional(),
  body: z.string(),
  disposition: DispositionSchema.optional(),
  disposition_note: z.string().optional(),
  disposition_version: z.number().int().optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

/**
 * One person's set of comments against one version, from first save
 * through submission and disposition. "The submission is the unit of
 * meaning" — comments are never records of their own.
 */
export const SubmissionRecordSchema = z.object({
  document: z.string().regex(SLUG_PATTERN),
  id: z.string().regex(SUBMISSION_ID_PATTERN),
  person: z.string().regex(SLUG_PATTERN),
  version: z.number().int().min(1),
  state: z.enum(["draft", "submitted"]),
  judgement: JudgementSchema.optional(),
  reason: z.string().optional(),
  // Default (`[]`) lives in `.gitsheets/submissions.toml`'s JSON Schema;
  // see the note on `documents.ts`'s equivalent fields.
  comments: z.array(CommentSchema).optional(),
});

export type SubmissionRecord = z.infer<typeof SubmissionRecordSchema>;
