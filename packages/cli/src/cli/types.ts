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
  /**
   * Live signatures attached to a version older than the current one
   * (`specs/api/admin.md`; `specs/behaviors/signatures.md` § A signature
   * belongs to a version). Absent on the public counts.
   */
  behind?: number;
}

export interface DocumentSummary {
  slug: string;
  title: string;
  /** `specs/behaviors/sites.md`: the site this document belongs to; `default` when it names none. */
  site?: string;
  /** The canonical origin this document's personal and public links are built on. */
  site_url?: string;
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
  /** Drafting-time read access to the working document. */
  public_access?: string;
  /**
   * `specs/data-model.md` § Audience — stored on the document, and
   * independent of `public_access`.
   */
  audience?: string;
  addressed_to?: string[];
  show_signatories?: string;
  revocation_window_hours?: number;
  tags?: string[];
  counts: {
    versions: number;
    participations: number;
    signatures: SignatoryCounts;
    submissions: { submitted: number; draft: number };
    /** `specs/behaviors/notifications.md` § Segments: who the operator commands reach. */
    unopened?: number;
    undecided?: number;
    needs_confirmation?: number;
  };
  /** `specs/behaviors/signatures.md` § Delivery. */
  delivered_at?: string;
  delivered_note?: string;
  commit?: string | null;
}

/**
 * `specs/api/admin.md` § schedule / reopen / versions: an announcement the
 * operator may ask for. `would_notify` is always reported, so a command run
 * without the flag still says whom it did not tell.
 */
export interface AnnounceReport {
  requested: boolean;
  would_notify: number;
  sent?: number;
  failed?: number;
  failures?: Array<{ person: string; error: string }>;
}

export interface DeadlineShift {
  deadline: "comments_close_at" | "signing_closes_at";
  from?: string;
  to: string;
}

/** `POST .../schedule` and `.../reopen`. */
export interface ScheduleResult extends DocumentSummary {
  deadlines?: DeadlineShift[];
  notify?: AnnounceReport;
}

export interface ScheduleDryRun {
  dry_run: true;
  deadlines: DeadlineShift[];
  notify: AnnounceReport;
}

/** `POST .../confirm-call`. */
export interface ConfirmCallResult {
  by: string;
  sent: number;
  failed: number;
  failures: Array<{ person: string; error: string }>;
  commit: string | null;
}

export interface ConfirmCallDryRun {
  dry_run: true;
  by: string;
  would_send: Array<{
    person: string;
    name: string;
    reason: "behind" | "conditional";
    signed_on_version?: number;
  }>;
}

/** `POST .../delivered`. */
export interface DeliveredResult extends DocumentSummary {
  sent: number;
  failed: number;
  failures: Array<{ person: string; error: string }>;
}

export interface VersionListItem {
  number: number;
  summary: string;
  published_at: string;
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
  notes?: string;
  body: string;
  dispositions: DispositionRecord[];
}

export interface PublishResult {
  number: number;
  summary: string;
  commit: string | null;
  signing_closes_at?: string;
  /** `specs/api/admin.md` § Versions: nobody is mailed without `notify_commenters`. */
  notified: { commenters: AnnounceReport };
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
  /** Whether `--update` was in force — what the row was allowed to overwrite. */
  update: boolean;
  /** The site the rows were merged into; an email is unique within it, not across the instance. */
  site: string;
  people_created: number;
  people_updated: number;
  people_overwritten: number;
  invitations_created: number;
  skipped_existing: number;
  dry_run?: boolean;
  rows?: Array<{
    email: string;
    name: string;
    person: string;
    action: string;
    /** What this row would really change in this mode; prefill fields as `prefill.<field>`. */
    would_change: string[];
    /** Set person fields the row differs from and would leave alone — what `--update` would act on. */
    kept: string[];
  }>;
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

/** `specs/behaviors/notifications.md` § Defaults: the two preferences. */
export interface PrefsView {
  channel: string;
  my_comments_addressed: boolean;
  reminders: boolean;
}

export interface InvitationRow {
  person: string;
  /** This document's resolved sign-card name — the participation's prefill, else the person's default. */
  name: string;
  /** This document's resolved sign-card organization, resolved the same way. */
  org: string;
  prefill: { name?: string; org?: string; role?: string; descriptor?: string };
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

/** `POST .../invitations/:person/expire` — the instant the API stored. */
export interface ExpireLinkResult {
  expires_at: string;
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
  /** Only when `--person` was given: each named person not reminded, and why. */
  skipped?: Array<{
    person: string;
    reason: "not_in_target" | "link_revoked" | "recently_messaged" | "reminders_off";
  }>;
  failures?: Array<{ person: string; error: string }>;
  commit?: string | null;
}

export interface SignatureListRow {
  person: string;
  name: string;
  /** True when this signature is attached to an older version than the current one. */
  behind?: boolean;
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
  /**
   * The date the last operator digest went out for this document
   * (`specs/behaviors/notifications.md` § Operator digest). Absent when
   * none has: an operator message writes nothing to a participation, so
   * `sent` above cannot show it.
   */
  operator_digest_sent?: string;
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
  /**
   * `specs/api/admin-cli.md`: the site this credential belongs to — the
   * same command against two profiles is two different tenants
   * (`specs/behaviors/sites.md`).
   */
  site?: { slug: string; name: string; hostname?: string };
}

/** `specs/api/admin.md` § Sites — one site, whole. */
export interface SiteDetail {
  slug: string;
  hostname?: string;
  name: string;
  sender_name?: string;
  sender_email?: string;
  reply_to?: string;
  logo_url?: string;
  accent?: string;
  operators: string[];
  documents: number;
  /** The From line mail from this site will actually use. */
  from_line: string;
  /** Observations, never promises: `null` is "not observed yet". */
  hostname_verified: boolean;
  sender_verified: boolean | null;
  dns: DnsRecord[];
  default: boolean;
  commit?: string | null;
}

/** One DNS record the customer still has to add; the service never touches DNS. */
export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  purpose: string;
}

export interface SiteOperator {
  email: string;
  name: string;
  kind: "person" | "bot";
  active: boolean;
  superadmin?: boolean;
}

/** `specs/api/admin.md` § Operators — the resolved site's operator group. */
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
