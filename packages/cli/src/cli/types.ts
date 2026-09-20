/**
 * Response shapes returned by `/admin/api/*` (`specs/api/admin.md`).
 * Hand-mirrored rather than imported from `apps/api` — this is a black-box
 * HTTP client, and importing server-internal types across the package
 * boundary would drag `packages/cli`'s TypeScript project outside its own
 * `rootDir`.
 */

export type DocumentState = "draft" | "open" | "closed" | "withdrawn";
export type Phase = "draft" | "commenting" | "signing" | "closed" | "withdrawn";

export interface SignatoryCounts {
  organizations: number;
  individuals: number;
  unlisted: number;
}

export interface DocumentSummary {
  slug: string;
  title: string;
  state: DocumentState;
  phase: Phase;
  opened_at?: string;
  comments_close_at?: string;
  signing_closes_at?: string;
  created_by: string;
  operators: string[];
  sender_name: string;
  reply_to: string;
  capacities?: string[];
  public_access?: string;
  show_signatories?: string;
  revocation_window_hours?: number;
  tags?: string[];
  counts: {
    versions: number;
    participations: number;
    signatures: SignatoryCounts;
    submissions: { submitted: number; draft: number };
  };
  commit?: string | null;
}

export interface VersionListItem {
  number: number;
  summary: string;
  published_at: string;
  final: boolean;
  dispositions: number;
}

export interface DocumentDetail extends DocumentSummary {
  versions: VersionListItem[];
}

/**
 * `POST /documents/:slug/open` — the summary plus what the invitation blast
 * actually delivered (`specs/api/admin.md`).
 */
export interface OpenResult extends DocumentSummary {
  invitations?: {
    sent: number;
    failed: number;
    failures: Array<{ person: string; error: string }>;
  };
}

export interface DispositionRecord {
  submission: string;
  comment: string;
  outcome: string;
  note?: string;
}

/**
 * The single-version admin read (`GET .../versions/:n`) — note `dispositions`
 * here is the array of disposition records for this version, not the count
 * `VersionListItem.dispositions` returns in the list view.
 */
export interface VersionDetail {
  number: number;
  commit: string | null;
  summary: string;
  published_at: string;
  published_by?: string;
  final: boolean;
  notes?: string;
  body: string;
  dispositions: DispositionRecord[];
}

export interface NotifiedCounts {
  every_revision: number;
  dispositions: number;
  signers: number;
}

export interface PublishResult {
  number: number;
  summary: string;
  commit: string | null;
  signing_closes_at?: string;
  notified: NotifiedCounts;
}

export interface CompareBlock {
  [key: string]: unknown;
}

export interface CompareResult {
  from: number;
  to: number;
  summary: string;
  blocks: CompareBlock[];
}

export interface ImportResult {
  people_created: number;
  people_updated: number;
  invitations_created: number;
  skipped_existing: number;
  dry_run?: boolean;
  rows?: Array<{ email: string; name: string; person: string; action: string; changes: string[] }>;
  commit?: string | null;
}

export interface SignatureView {
  capacity: string;
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

export interface PrefsView {
  channel: string;
  every_revision: boolean;
  daily_digest: boolean;
  phase_changes: boolean;
  my_comments_addressed: boolean;
  reminders: boolean;
  forced: string[];
}

export interface InvitationRow {
  person: string;
  name: string;
  email: string;
  status: string;
  source?: string;
  opened_at?: string;
  last_seen_at?: string;
  opens: number;
  sent_at?: string;
  link_revoked: boolean;
  signature: SignatureView | null;
  notify: PrefsView;
}

export interface SendResult {
  /** Messages the mailer accepted — absent on a dry run. */
  sent?: number;
  failed?: number;
  failures?: Array<{ person: string; error: string }>;
  dry_run?: boolean;
  would_send?: Array<{ person: string; name: string }>;
  skipped?: Array<{ person: string; reason: string }>;
  csv?: string;
  commit?: string | null;
}

export interface ReissueLinkResult {
  link: string;
  commit?: string | null;
}

export interface RevokeLinkResult {
  revoked: boolean;
  commit?: string | null;
}

export interface RemindResult {
  dry_run: boolean;
  /** Dry run only: how many would be reminded. */
  targeted?: number;
  sent?: number;
  failed?: number;
  skipped_recent: number;
  skipped_pref: number;
  min_age_hours: number;
  failures?: Array<{ person: string; error: string }>;
  commit?: string | null;
}

export interface SignatureListRow {
  person: string;
  name: string;
  signature: SignatureView | null;
}

export interface RevokeSignatureResult extends SignatureView {
  commit?: string | null;
}

export interface SubmissionComment {
  id: string;
  anchor: unknown;
  body: string;
  disposition: { outcome: string; note?: string; version?: number } | null;
}

export interface SubmissionView {
  id: string;
  author: string;
  person: string;
  version: number;
  state: "submitted" | "draft";
  judgement: string | null;
  reason?: string;
  started_at?: string;
  submitted_at?: string;
  comments: SubmissionComment[];
}

export interface FeedbackExport {
  document: string;
  version: { number: number; summary: string; body: string };
  submissions: { submitted: SubmissionView[]; draft: SubmissionView[] };
  judgement_tally: Record<number, Record<string, number>>;
  signatory_count: SignatoryCounts;
}

export interface NotificationsSummary {
  sent: Record<string, number>;
  pending: number;
  failed: number;
  failures?: Array<{ event: string; person: string; error: string; at: string }>;
}

export interface NotificationsRetryResult {
  retried: number;
}

/** `GET /admin/api/whoami` (`specs/api/admin.md` § Instance). */
export interface WhoAmI {
  email: string;
  name: string;
  kind: "person" | "bot";
  expires_at: string;
  transport: "bearer" | "cookie";
}

/** `specs/api/admin.md` § Operators — the global operator directory. */
export interface OperatorRecord {
  email: string;
  name: string;
  kind: "person" | "bot";
  active: boolean;
  superadmin?: boolean;
  title?: string;
  org?: string;
}

export interface OperatorMutationResult extends OperatorRecord {
  commit?: string | null;
}

/** `POST /documents/:slug/operators` response — the added operator plus whether it was new. */
export interface DocOperatorAddResult extends OperatorRecord {
  added: boolean;
  commit?: string | null;
}
