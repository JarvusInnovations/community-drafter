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
  | "not_sent"
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
  created_by?: string;
  operators?: string[];
  sender_name?: string;
  reply_to?: string;
  capacities?: Capacity[];
  /**
   * `specs/data-model.md` § Audience. `public_access` is drafting-time read
   * access to the working document; `audience` and `addressed_to` say who
   * the finished statement is published or delivered to. Independent.
   */
  public_access?: "none" | "read" | "participate";
  audience: "public" | "closed";
  addressed_to?: string[];
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
  /**
   * `specs/screens/admin-dashboard.md` § Recent activity: the deadlines an
   * `extend`/`reopen` moved, with the literal times they moved from and to.
   */
  deadlines?: DeadlineShift[];
  actor: string;
  /**
   * `specs/behaviors/operators.md` § Superadmins: set when the actor is
   * not one of the document's operators and holds the superadmin flag.
   */
  actor_superadmin?: boolean;
}

export interface DeadlineShift {
  deadline: "comments_close_at" | "signing_closes_at";
  /** Absent when the document had no such deadline before. */
  from?: string;
  to: string;
}

export interface NotificationsHealth {
  sent: Record<string, number>;
  pending: number;
  failed: number;
}

export interface SessionInfo {
  email: string;
  name?: string;
  kind?: "person" | "bot";
  superadmin?: boolean;
  expires_at: string;
  /** `specs/api/auth.md`: the configured `INSTANCE_NAME`, shown in the admin frame. */
  instance_name?: string;
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
  notes?: string;
  commit?: string | null;
}

/** The JSON error envelope, `specs/api/conventions.md` § Responses. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
