import type {
  Action,
  DocumentRecord,
  Judgement,
  ParticipationRecord,
  PersonRecord,
  SubmissionRecord,
  Trailers,
} from "@community-drafter/shared";

import { logWithTrailers, readFileAtCommit, splitFrontmatter } from "./git-log.ts";
import type { DataStore } from "./schemas.ts";

/** Actions that write the `documents` record itself (settings and/or body). */
const DOCUMENT_MUTATING_ACTIONS = new Set<Action>([
  "create",
  "settings",
  "open",
  "extend",
  "close",
  "reopen",
  "withdraw",
  "publish",
]);

const SIGNATURE_ACTIONS = new Set<Action>(["sign", "resign", "revoke", "admin-revoke"]);

/** Actions whose commit patches one participation record directly (not a bulk sheet reload). */
const PARTICIPATION_ACTIONS = new Set<Action>([
  "sign",
  "resign",
  "revoke",
  "admin-revoke",
  "prefs",
  "track",
  "link-revoke",
  "link-reissue",
]);

const SUBMISSION_ACTIONS = new Set<Action>(["comment", "submit"]);

export interface DocumentVersion {
  number: number;
  commit: string;
  summary: string;
  published_at: string;
  published_by: string;
  final: boolean;
  notes?: string;
  body: string;
}

export interface ActivityEntry {
  commit: string;
  action: Action;
  actor: string;
  at: string;
  subject: string;
  trailers: Record<string, string>;
}

export interface DocumentEntry {
  record: DocumentRecord;
  versions: DocumentVersion[];
  /** Commits touching the document record itself, newest first. */
  activity: ActivityEntry[];
}

export interface SignatureEvent {
  action: "sign" | "resign" | "revoke" | "admin-revoke";
  at: string;
  actor: string;
  commit: string;
  reason?: string;
}

export interface ParticipationEntry {
  record: ParticipationRecord;
  /** Sign/resign/revoke history for this participation, oldest first. */
  signatureEvents: SignatureEvent[];
}

export interface SubmissionTiming {
  /** When the submission's first commit landed (first save). */
  startedAt?: string;
  /** Every `Action: comment` (save) commit's timestamp, oldest first. */
  savedAt: string[];
  /** The `Action: submit` commit's timestamp, if submitted. */
  submittedAt?: string;
}

export interface SubmissionEntry {
  record: SubmissionRecord;
  timing: SubmissionTiming;
}

/** A person's latest judgement on a document — the "position" data-model.md derives, never stores. */
export interface Position {
  submissionId: string;
  judgement: Judgement;
  version: number;
  submittedAt: string;
}

function participationKey(document: string, person: string): string {
  return `${document}/${person}`;
}

function submissionKey(document: string, id: string): string {
  return `${document}/${id}`;
}

function toActivityEntry(entry: {
  hash: string;
  committerDate: string;
  authorName: string;
  subject: string;
  trailers: Record<string, string>;
}): ActivityEntry {
  const action = (entry.trailers.Action ?? "unknown") as Action;
  return {
    commit: entry.hash,
    action,
    actor: entry.trailers.Actor ?? entry.authorName,
    at: entry.committerDate,
    subject: entry.subject,
    trailers: entry.trailers,
  };
}

/**
 * The in-memory read model built at boot from the four sheets plus one
 * `git log --first-parent` pass per record over that record's own path
 * (`specs/architecture.md` § Storage). Rebuilt whole at boot via `build()`;
 * updated one entity at a time via the `refresh*` methods after every commit
 * the service makes (wired by `apps/api/src/storage/plugin.ts`).
 */
export class ReadModel {
  private readonly documents = new Map<string, DocumentEntry>();
  private readonly people = new Map<string, PersonRecord>();
  private readonly participations = new Map<string, ParticipationEntry>();
  private readonly participationsByToken = new Map<string, string>();
  private readonly submissions = new Map<string, SubmissionEntry>();
  private readonly positions = new Map<string, Position>();

  constructor(
    private readonly store: DataStore,
    private readonly dataDir: string,
  ) {}

  async build(): Promise<void> {
    await this.refreshPeople();

    const participations = await this.store.participations.queryAll();
    this.participations.clear();
    this.participationsByToken.clear();
    await Promise.all(
      participations.map((record) => this.indexParticipation(record.document, record.person)),
    );

    const submissions = await this.store.submissions.queryAll();
    this.submissions.clear();
    this.positions.clear();
    await Promise.all(
      submissions.map((record) => this.indexSubmission(record.document, record.id)),
    );

    const documents = await this.store.documents.queryAll({}, { withBody: false });
    this.documents.clear();
    await Promise.all(documents.map((record) => this.indexDocument(record.slug)));
  }

  async refreshPeople(): Promise<void> {
    const people = await this.store.people.queryAll();
    this.people.clear();
    for (const person of people) this.people.set(person.id, person);
  }

  async refreshDocument(slug: string): Promise<void> {
    await this.indexDocument(slug);
  }

  async refreshParticipation(document: string, person: string): Promise<void> {
    await this.indexParticipation(document, person);
  }

  async refreshSubmission(document: string, id: string): Promise<void> {
    await this.indexSubmission(document, id);
  }

  /** Refresh every participation on a document — used after a bulk `invite` commit. */
  async refreshParticipationsForDocument(document: string): Promise<void> {
    const records = await this.store.participations.queryAll({ document });
    await Promise.all(records.map((r) => this.indexParticipation(r.document, r.person)));
  }

  /**
   * Update the read model for one commit the service just made, without a
   * full rebuild — `specs/architecture.md`: "updated on every write."
   * Dispatches on the trailer set rather than requiring every call site to
   * know which parts of the model its action affects.
   */
  async applyCommit(trailers: Trailers): Promise<void> {
    const { Action: action, Document: document, Person: person, Submission: submission } = trailers;

    if (action === "invite") {
      await this.refreshPeople();
      if (document) await this.refreshParticipationsForDocument(document);
    }

    if (action === "send" && document) {
      await this.refreshParticipationsForDocument(document);
    }

    if (document && DOCUMENT_MUTATING_ACTIONS.has(action)) {
      await this.refreshDocument(document);
    }

    if (document && person && PARTICIPATION_ACTIONS.has(action)) {
      await this.refreshParticipation(document, person);
    }

    if (document && submission && SUBMISSION_ACTIONS.has(action)) {
      await this.refreshSubmission(document, submission);
    }

    // A publish may set dispositions on submissions from an earlier version
    // (`Disposed: <submission>:<comment>, …`) in the same commit.
    if (document && trailers.Disposed) {
      const ids = new Set(
        trailers.Disposed.split(",")
          .map((ref) => ref.trim().split(":")[0])
          .filter((id): id is string => Boolean(id)),
      );
      for (const id of ids) await this.refreshSubmission(document, id);
    }
  }

  private async indexDocument(slug: string): Promise<void> {
    const record = await this.store.documents.queryFirst({ slug });
    if (!record) {
      this.documents.delete(slug);
      return;
    }
    const hydrated = await this.store.documents.loadBody(record);

    const relPath = `documents/${await this.store.documents.pathForRecord(record)}.md`;
    const log = await logWithTrailers(this.dataDir, relPath);

    const activity: ActivityEntry[] = [];
    const versions: DocumentVersion[] = [];
    let previousBody: string | undefined;

    for (const entry of log) {
      activity.push(toActivityEntry(entry));

      const action = entry.trailers.Action as Action | undefined;
      if (!action || !DOCUMENT_MUTATING_ACTIONS.has(action)) continue;

      const raw = await readFileAtCommit(this.dataDir, entry.hash, relPath);
      if (raw === null) continue;
      const { body } = splitFrontmatter(raw);

      if (body === previousBody) continue;
      previousBody = body;

      versions.push({
        number: versions.length + 1,
        commit: entry.hash,
        summary: entry.trailers.Summary ?? stripPublishPrefix(entry.subject, slug),
        published_at: entry.committerDate,
        published_by: entry.trailers.Actor ?? entry.authorName,
        final: entry.trailers.Final === "true",
        notes: entry.trailers.Notes,
        body,
      });
    }

    activity.reverse(); // newest first for display
    this.documents.set(slug, { record: hydrated, versions, activity });
  }

  private async indexParticipation(document: string, person: string): Promise<void> {
    const record = await this.store.participations.queryFirst({ document, person });
    const key = participationKey(document, person);
    if (!record) {
      const existing = this.participations.get(key);
      if (existing) this.participationsByToken.delete(existing.record.token);
      this.participations.delete(key);
      return;
    }

    const relPath = `participations/${await this.store.participations.pathForRecord(record)}.toml`;
    const log = await logWithTrailers(this.dataDir, relPath);

    const signatureEvents: SignatureEvent[] = [];
    for (const entry of log) {
      const action = entry.trailers.Action as Action | undefined;
      if (!action || !SIGNATURE_ACTIONS.has(action)) continue;
      signatureEvents.push({
        action: action as SignatureEvent["action"],
        at: entry.committerDate,
        actor: entry.trailers.Actor ?? entry.authorName,
        commit: entry.hash,
        reason: entry.trailers.Reason,
      });
    }

    const existing = this.participations.get(key);
    if (existing && existing.record.token !== record.token) {
      this.participationsByToken.delete(existing.record.token);
    }
    this.participations.set(key, { record, signatureEvents });
    this.participationsByToken.set(record.token, key);
  }

  private async indexSubmission(document: string, id: string): Promise<void> {
    const record = await this.store.submissions.queryFirst({ document, id });
    const key = submissionKey(document, id);
    if (!record) {
      this.submissions.delete(key);
      return;
    }

    const relPath = `submissions/${await this.store.submissions.pathForRecord(record)}.toml`;
    const log = await logWithTrailers(this.dataDir, relPath);

    const timing: SubmissionTiming = { savedAt: [] };
    for (const entry of log) {
      const action = entry.trailers.Action as Action | undefined;
      if (timing.startedAt === undefined) timing.startedAt = entry.committerDate;
      if (action === "comment") timing.savedAt.push(entry.committerDate);
      if (action === "submit") timing.submittedAt = entry.committerDate;
    }

    this.submissions.set(key, { record, timing });
    this.recomputePosition(document, record.person);
  }

  private recomputePosition(document: string, person: string): void {
    const key = participationKey(document, person);
    let best: Position | undefined;

    for (const entry of this.submissions.values()) {
      if (entry.record.document !== document) continue;
      if (entry.record.person !== person) continue;
      if (entry.record.state !== "submitted") continue;
      if (!entry.timing.submittedAt || !entry.record.judgement) continue;

      if (!best || entry.timing.submittedAt > best.submittedAt) {
        best = {
          submissionId: entry.record.id,
          judgement: entry.record.judgement,
          version: entry.record.version,
          submittedAt: entry.timing.submittedAt,
        };
      }
    }

    if (best) this.positions.set(key, best);
    else this.positions.delete(key);
  }

  // --- Accessors ---

  getDocument(slug: string): DocumentEntry | undefined {
    return this.documents.get(slug);
  }

  listDocuments(): DocumentEntry[] {
    return [...this.documents.values()];
  }

  getPerson(id: string): PersonRecord | undefined {
    return this.people.get(id);
  }

  getParticipation(document: string, person: string): ParticipationEntry | undefined {
    return this.participations.get(participationKey(document, person));
  }

  /** Constant-time token → participation lookup (the personal-link credential). */
  getParticipationByToken(token: string): ParticipationEntry | undefined {
    const key = this.participationsByToken.get(token);
    return key ? this.participations.get(key) : undefined;
  }

  getSubmission(document: string, id: string): SubmissionEntry | undefined {
    return this.submissions.get(submissionKey(document, id));
  }

  listSubmissionsForDocument(document: string): SubmissionEntry[] {
    return [...this.submissions.values()].filter((s) => s.record.document === document);
  }

  getPosition(document: string, person: string): Position | undefined {
    return this.positions.get(participationKey(document, person));
  }

  /** Snapshot summary for readiness reporting (`/_health`). */
  summary(): { documents: number; people: number; participations: number; submissions: number } {
    return {
      documents: this.documents.size,
      people: this.people.size,
      participations: this.participations.size,
      submissions: this.submissions.size,
    };
  }
}

/** `publish: <slug> v<n>` prefix stripped, per the version `summary` derivation rule. */
function stripPublishPrefix(subject: string, slug: string): string {
  const prefix = new RegExp(`^publish:\\s*${escapeRegExp(slug)}\\s*v\\d+\\s*`, "i");
  return subject.replace(prefix, "").trim() || subject;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
