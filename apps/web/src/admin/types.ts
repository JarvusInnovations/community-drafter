/**
 * Hand-authored wire types mirroring `specs/api/admin.md`'s JSON shapes —
 * same rationale as `participant/types.ts`: keeps the heavy
 * `@community-drafter/shared` render-pipeline barrel out of the web bundle.
 * The admin bundle isn't budget-constrained the way the participant entry
 * is, but every admin screen is lazy-loaded (`App.tsx`), so there's no
 * reason to pull that barrel in either.
 */

export type Capacity = "personal" | "official";
export type ShowSignatories = "list" | "count" | "none";
export type DocumentState = "draft" | "open" | "closed" | "withdrawn";
export type Phase = "draft" | "commenting" | "signing" | "closed" | "withdrawn";
export type ParticipationStatus =
  | "unopened"
  | "opened"
  | "drafting"
  | "commented"
  | "signed"
  | "signed_conditional"
  | "declined"
  | "revoked";

export interface DocumentSummary {
  slug: string;
  title: string;
  state: DocumentState;
  phase: Phase;
  opened_at?: string;
  comments_close_at?: string;
  signing_closes_at?: string;
  owner?: string;
  sender_name?: string;
  reply_to?: string;
  capacities?: Capacity[];
  public_access?: "none" | "read" | "participate";
  show_signatories?: ShowSignatories;
  revocation_window_hours?: number;
  tags?: string[];
  commit?: string | null;
  counts: {
    versions: number;
    participations: number;
    signatures: { organizations: number; individuals: number; unlisted: number };
    submissions: { submitted: number; draft: number };
  };
}

export interface DocumentDetail extends DocumentSummary {
  versions: VersionListItem[];
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
  commit?: string | null;
  published_by?: string;
  notes?: string;
  body: string;
  dispositions: unknown[];
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

export interface NotifyPrefs {
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
  status: ParticipationStatus;
  source?: string;
  opened_at?: string;
  last_seen_at?: string;
  opens: number;
  sent_at?: string;
  link_revoked: boolean;
  signature: SignatureView | null;
  notify: NotifyPrefs;
}

export interface CommentView {
  id: string;
  anchor: unknown | null;
  body: string;
  disposition: { outcome: string; note?: string; version?: number } | null;
}

export interface SubmissionView {
  id: string;
  author: string;
  person: string;
  version: number;
  state: "draft" | "submitted";
  judgement: string | null;
  reason?: string;
  started_at?: string;
  submitted_at?: string;
  comments: CommentView[];
}

export interface ActivityEntry {
  commit: string;
  date: string;
  subject: string;
  action: string;
  person?: string;
  version?: number;
  judgement?: string;
  reason?: string;
  actor: string;
}

export interface NotificationsHealth {
  sent: Record<string, number>;
  pending: number;
  failed: number;
}

export interface SessionInfo {
  email: string;
  name?: string;
  expires_at: string;
}

/** The JSON error envelope, `specs/api/conventions.md` § Responses. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
