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
  owner: string;
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
  queued: number;
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
  targeted: number;
  dry_run: boolean;
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
}

export interface NotificationsRetryResult {
  retried: number;
}

export interface WhoAmI {
  actor: string;
  capability: string;
}
