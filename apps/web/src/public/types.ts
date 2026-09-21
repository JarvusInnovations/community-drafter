/**
 * Hand-authored wire types for `/d/:slug/api/*`, mirroring
 * `specs/screens/public-and-embed.md` § Data Requirements — the same shape
 * family as `../participant/types.ts` minus every person-specific field
 * (no `person`, `signature`, `position`, `submissions`, `prefill`,
 * `notify`) and minus `capacities` (irrelevant with no sign form here).
 * Kept as its own module, not imported from `@signatories/shared`,
 * for the same reason as the participant mirror (see that file's doc
 * comment): no runtime need to pull in the server-only render pipeline.
 */

export type ShowSignatories = "list" | "count" | "none";
export type DocumentState = "draft" | "open" | "closed" | "withdrawn";
export type Phase = "draft" | "commenting" | "signing" | "closed" | "withdrawn";
export type Capacity = "personal" | "official";
export type BlockStatus = "same" | "changed" | "added" | "removed";

/**
 * `specs/screens/public-and-embed.md` § Site identity: the document's site
 * — its logo when set, otherwise its name, and the accent it overrides.
 */
export interface PublicSiteInfo {
  name: string;
  logo_url?: string;
  accent?: string;
}

export interface PublicDocumentInfo {
  slug: string;
  title: string;
  state: DocumentState;
  phase: Phase;
  opened_at?: string;
  comments_close_at?: string;
  signing_closes_at?: string;
  show_signatories: ShowSignatories;
  reply_to?: string;
  sender_name?: string;
  /**
   * `specs/screens/public-and-embed.md` § Data Requirements: here for one
   * reason — it decides whether the footer offers the statement download
   * (`specs/screens/deliverable.md`). `public_access` is not in this
   * payload and never has been.
   */
  audience?: "public" | "closed";
}

export interface PublicVersionInfo {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  html: string;
  is_current: boolean;
}

export interface PublicVersionListItem {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  dispositions: number;
}

export interface PublicVersionDetail {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  html: string;
}

export interface SignatoryListItem {
  display_name: string;
  capacity: Capacity;
  descriptor?: string;
  org?: string;
  title?: string;
}

export interface SignatorySummary {
  organizations: number;
  individuals: number;
  unlisted: number;
  list?: SignatoryListItem[];
  /** ISO 8601 — the most recent sign/resign among current signatories. */
  updated_at?: string;
}

export interface PublicBundle {
  site: PublicSiteInfo;
  document: PublicDocumentInfo;
  version: PublicVersionInfo;
  versions: PublicVersionListItem[];
  signatories: SignatorySummary | null;
}

export interface CompareBlock {
  status: BlockStatus;
  id: string;
  html: string;
}

/** One clause of the compare summary line, `specs/api/participant.md` § compare. */
export interface DiffSummaryItem {
  kind: "paragraph" | "heading" | "list item" | "table";
  change: "changed" | "added" | "removed";
  count: number;
}

export interface CompareResult {
  from: number;
  to: number;
  summary: { changed: number; added: number; removed: number; items: DiffSummaryItem[] };
  blocks: CompareBlock[];
}

/** The JSON error envelope, `specs/api/conventions.md` § Responses. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
