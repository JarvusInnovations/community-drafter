/**
 * Hand-authored types mirroring `specs/api/participant.md`'s JSON shapes.
 * Deliberately not imported from `@community-drafter/shared` — that
 * package's main barrel pulls in the server-only `unified`/remark/rehype
 * render pipeline (see `packages/shared/src/browser.ts`'s own doc comment),
 * and this plan's compare/diff rendering is server-computed HTML the
 * participant app only displays, so there's no runtime need for the shared
 * package here at all. Keeping the wire types local avoids any risk of the
 * heavy barrel leaking into the participant bundle
 * (`specs/architecture.md`'s 120 KB gzipped budget).
 */

export type Capacity = "personal" | "official";
export type ShowSignatories = "list" | "count" | "none";
/**
 * `specs/data-model.md` § Audience — a stored field saying who the finished
 * statement is published or delivered to. Not `public_access`, which is read
 * access to the working draft and never reaches a participant surface.
 */
export type Audience = "public" | "closed";
export type DocumentState = "draft" | "open" | "closed" | "withdrawn";
export type Phase = "draft" | "commenting" | "signing" | "closed" | "withdrawn";
export type Judgement = "sign" | "sign_conditional" | "decline" | string;
/**
 * The strict, closed form (`specs/behaviors/review-and-judgement.md` §
 * Submission table) — used where a value is always one the client itself
 * constructs (the judgement picker, `POST submit`'s body), as opposed to
 * `Judgement` above, which stays open for defensively displaying whatever a
 * past submission record happens to carry.
 */
export type SubmissionJudgement = "sign" | "sign_conditional" | "comment" | "decline";
export type Disposition = "accepted" | "partial" | "declined" | "noted";
export type BlockStatus = "same" | "changed" | "added" | "removed";

/**
 * `specs/api/participant.md`: the **document's** site — name, and logo and
 * accent where set (`specs/behaviors/sites.md` § Identity on a surface). It
 * replaces the earlier `instance: { name }`.
 */
export interface SiteInfo {
  name: string;
  logo_url?: string;
  accent?: string;
}

export interface PersonInfo {
  id: string;
  name: string;
}

export interface DocumentInfo {
  slug: string;
  title: string;
  state: DocumentState;
  phase: Phase;
  opened_at?: string;
  comments_close_at?: string;
  signing_closes_at?: string;
  capacities: Capacity[];
  show_signatories: ShowSignatories;
  audience: Audience;
  /** Who the finished statement goes to (`specs/data-model.md` § Audience). */
  addressed_to: string[];
  reply_to?: string;
  sender_name?: string;
}

export interface VersionInfo {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  html: string;
  is_current: boolean;
}

export interface VersionListItem {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  dispositions: number;
}

export interface VersionDetail {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  html: string;
  my_comments: {
    id: string;
    anchor: unknown | null;
    body: string;
    disposition: { outcome: Disposition; note?: string; version?: number } | null;
  }[];
}

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

export interface PositionInfo {
  judgement: Judgement;
  version: number;
  at?: string;
  submission?: string;
}

export interface CommentView {
  id: string;
  anchor: unknown | null;
  body: string;
  saved_at?: string;
  disposition: { outcome: Disposition; note?: string; version?: number } | null;
}

export interface SubmissionView {
  id: string;
  version: number;
  state: "draft" | "submitted";
  judgement: Judgement | null;
  reason?: string;
  started_at?: string;
  submitted_at?: string;
  comments: CommentView[];
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
}

export interface PrefillInfo {
  name?: string;
  org?: string;
  role?: string;
  descriptor?: string;
  suggested_capacity?: Capacity;
}

export interface NotifyPrefs {
  channel: string;
  every_revision: boolean;
  daily_digest: boolean;
  phase_changes: boolean;
  my_comments_addressed: boolean;
  reminders: boolean;
  forced: string[];
}

export interface Bundle {
  site: SiteInfo;
  person: PersonInfo;
  document: DocumentInfo;
  version: VersionInfo;
  versions: VersionListItem[];
  signature: SignatureView | null;
  position: PositionInfo | null;
  submissions: SubmissionView[];
  signatories: SignatorySummary | null;
  prefill: PrefillInfo;
  notify: NotifyPrefs;
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

/** `specs/api/participant.md` § Draft submission endpoints. */
export interface DraftCommentCreateResult {
  submission: string;
  id: string;
  saved_at: string;
}

export interface DraftCommentSaveResult {
  saved_at: string;
}

export interface RebasePlacement {
  id: string;
  placed: boolean;
}

export interface RebaseResult {
  submission: string;
  version: number;
  comments: RebasePlacement[];
}

export interface SubmitResult {
  submission: SubmissionView | null;
  signature: SignatureView | null;
}
