import { DEFAULT_SITE_SLUG } from "@signatories/shared";
import type {
  Action,
  DocumentRecord,
  Judgement,
  OperatorRecord,
  ParticipationRecord,
  PersonRecord,
  SiteRecord,
  SubmissionRecord,
  Trailers,
} from "@signatories/shared";

import {
  type CommitLogEntry,
  logWithTrailers,
  readFileAtCommit,
  splitFrontmatter,
} from "./git-log.ts";
import { SHEET_LOCATIONS } from "./schemas.ts";
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

/**
 * `specs/behaviors/signatures.md` § Signing: "Signing through comment mode is
 * the same signature by another door. A `submit` commit that writes,
 * re-instates or revokes the `signature` table carries a `Signature` trailer
 * ... and is read back as that signature event."
 */
const SIGNATURE_TRAILER_ACTIONS = new Set<string>(["sign", "resign", "revoke"]);

/** Actions whose commit patches one participation record directly (not a bulk sheet reload). */
const PARTICIPATION_ACTIONS = new Set<Action>([
  "uninvite",
  "sign",
  "resign",
  "revoke",
  "admin-revoke",
  "prefs",
  "track",
  "link-revoke",
  "link-reissue",
  "link-export",
  "link-expire",
  // A `submit` commit (e.g. `decline`, or a future `sign`/`sign_conditional`
  // submission) may co-write the participation's `signature` table in the
  // same commit as the submission record — see `routes/participant/decline.ts`.
  "submit",
]);

const SUBMISSION_ACTIONS = new Set<Action>(["comment", "submit"]);

/** Actions that write the `operators` sheet. */
const OPERATOR_ACTIONS = new Set<Action>(["operator-add", "operator-update", "operator-remove"]);

/** Actions that write the `sites` sheet (`specs/behaviors/sites.md`). */
const SITE_ACTIONS = new Set<Action>([
  "site-create",
  "site-update",
  "site-remove",
  "site-operator-add",
  "site-operator-remove",
]);

/** `specs/screens/admin-dashboard.md` § Recent activity: "the last 50 commits on this document". */
const ACTIVITY_LIMIT = 50;

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
  /**
   * The commit's `Action`, except for the one entry kind that is not a
   * commit of its own: `opened`, expanded from a `track` commit's `Opened`
   * trailer (`specs/api/admin.md` § Activity).
   */
  action: Action | "opened";
  actor: string;
  at: string;
  subject: string;
  trailers: Record<string, string>;
}

export interface DocumentEntry {
  record: DocumentRecord;
  versions: DocumentVersion[];
  /**
   * Every commit carrying this document's `Document` trailer — publishes,
   * settings changes, invites, signs, comments, submits — newest first,
   * capped at `ACTIVITY_LIMIT`. "The record's own event log"
   * (`specs/screens/admin-dashboard.md`), not just commits that touched the
   * document's own file.
   */
  activity: ActivityEntry[];
}

export interface SignatureEvent {
  action: "sign" | "resign" | "revoke" | "admin-revoke";
  at: string;
  actor: string;
  commit: string;
  reason?: string;
  /**
   * The commit's `Version` trailer. `specs/behaviors/signatures.md` § A
   * signature belongs to a version: on a record written before
   * `signed_on_version` existed, the version is read back from here.
   */
  version?: number;
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

/**
 * `specs/data-model.md` → `people`: the record's own path. A person id is
 * unique within a site and not across the instance, so the site is part of
 * every key the read model stores them under.
 */
function personKey(site: string, id: string): string {
  return `${site}/${id}`;
}

function submissionKey(document: string, id: string): string {
  return `${document}/${id}`;
}

function toActivityEntry(entry: CommitLogEntry): ActivityEntry {
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

/** The `Opened` trailer's person list (`specs/data-model.md`). */
function openedPeople(entry: CommitLogEntry): string[] {
  return (entry.trailers.Opened ?? "")
    .split(",")
    .map((person) => person.trim())
    .filter((person) => person.length > 0);
}

/**
 * `specs/screens/admin-dashboard.md` § Recent activity: a person's first
 * visit is an entry. One `track` commit records a whole flush, so it
 * expands into one `opened` entry per person its `Opened` trailer names —
 * and a `track` commit that recorded no first open produces nothing at
 * all, because a return visit is not news and a feed of them would bury
 * everything else.
 */
function expandActivity(entry: CommitLogEntry): ActivityEntry[] {
  const base = toActivityEntry(entry);
  if (base.action !== "track") return [base];

  return openedPeople(entry).map((person) => ({
    ...base,
    action: "opened" as const,
    subject: `opened: ${person} on ${entry.trailers.Document ?? ""}`.trimEnd(),
    trailers: { ...entry.trailers, Person: person },
  }));
}

/**
 * The in-memory read model built at boot from the four sheets plus **one**
 * `git log --first-parent` pass over the whole repo (`specs/architecture.md`
 * § Storage), bucketed by the `Document` / `Person` / `Submission` trailers
 * rather than by file path — a `sign`/`comment`/`submit` commit carries its
 * document's `Document` trailer but never touches `documents/<slug>.md`, and
 * the dashboard's "recent activity" is specified as every commit naming the
 * document (`specs/screens/admin-dashboard.md`), not just body/settings
 * commits. Resolved commit bodies are cached by `<hash>:<path>` (git history
 * is immutable, so this cache never needs invalidating) — a repeated log
 * refresh after every write commit only pays for bodies it hasn't seen.
 *
 * Rebuilt whole at boot via `build()`; updated via the `refresh*` methods
 * after every commit the service makes (wired by
 * `apps/api/src/storage/plugin.ts`'s `applyCommit`).
 */
export class ReadModel {
  private readonly documents = new Map<string, DocumentEntry>();
  private readonly operators = new Map<string, OperatorRecord>();
  private readonly operatorsByEmail = new Map<string, string>();
  private readonly people = new Map<string, PersonRecord>();
  private readonly sites = new Map<string, SiteRecord>();
  private readonly sitesByHostname = new Map<string, string>();
  private readonly participations = new Map<string, ParticipationEntry>();
  private readonly participationsByToken = new Map<string, string>();
  private readonly submissions = new Map<string, SubmissionEntry>();
  private readonly positions = new Map<string, Position>();

  private fullLog: CommitLogEntry[] = [];
  private readonly bodyCache = new Map<string, string>();

  constructor(
    private readonly store: DataStore,
    private readonly dataDir: string,
  ) {}

  async build(): Promise<void> {
    await this.refreshOperators();
    await this.refreshSites();
    await this.refreshPeople();
    await this.refreshLog();

    this.participations.clear();
    this.participationsByToken.clear();
    const participations = await this.store.participations.queryAll();
    for (const record of participations) this.setParticipationRecord(record);
    for (const record of participations) {
      this.computeSignatureEvents(record.document, record.person);
    }

    this.submissions.clear();
    const submissions = await this.store.submissions.queryAll();
    for (const record of submissions) this.setSubmissionRecord(record);
    for (const record of submissions) this.computeSubmissionTiming(record.document, record.id);
    this.recomputeAllPositions();

    this.documents.clear();
    const documents = await this.store.documents.queryAll({}, { withBody: false });
    for (const record of documents) {
      const hydrated = await this.store.documents.loadBody(record);
      await this.computeDocumentEntry(record.slug, hydrated);
    }
  }

  async refreshPeople(): Promise<void> {
    const people = await this.store.people.queryAll();
    this.people.clear();
    for (const person of people) this.people.set(personKey(person.site, person.id), person);
  }

  async refreshOperators(): Promise<void> {
    const operators = await this.store.operators.queryAll();
    this.operators.clear();
    this.operatorsByEmail.clear();
    for (const operator of operators) {
      this.operators.set(operator.id, operator);
      this.operatorsByEmail.set(operator.email.toLowerCase(), operator.id);
    }
  }

  /**
   * `specs/behaviors/sites.md`: sites are indexed by slug and by hostname,
   * the two keys resolution uses (a request's host, a document's `site`).
   * Hostnames are lowercased on the way in; matching is exact.
   */
  async refreshSites(): Promise<void> {
    const sites = await this.store.sites.queryAll();
    this.sites.clear();
    this.sitesByHostname.clear();
    for (const site of sites) {
      this.sites.set(site.slug, site);
      this.sitesByHostname.set(site.hostname.toLowerCase(), site.slug);
    }
  }

  async refreshDocument(slug: string): Promise<void> {
    await this.refreshLog();
    await this.reloadDocument(slug);
  }

  async refreshParticipation(document: string, person: string): Promise<void> {
    await this.refreshLog();
    await this.reloadParticipation(document, person);
  }

  async refreshSubmission(document: string, id: string): Promise<void> {
    await this.refreshLog();
    await this.reloadSubmission(document, id);
  }

  /** Refresh every participation on a document — used after a bulk `invite`/`send` commit. */
  async refreshParticipationsForDocument(document: string): Promise<void> {
    await this.refreshLog();
    await this.reloadParticipationsForDocument(document);
  }

  /**
   * Update the read model for one commit the service just made, without a
   * full rebuild — `specs/architecture.md`: "updated on every write."
   * Dispatches on the trailer set rather than requiring every call site to
   * know which parts of the model its action affects. Refreshes the log
   * once, then reloads only the sheet record(s) the commit's trailers name.
   */
  async applyCommit(trailers: Trailers): Promise<void> {
    const { Action: action, Document: document, Person: person, Submission: submission } = trailers;
    await this.refreshLog();

    if (OPERATOR_ACTIONS.has(action)) {
      await this.refreshOperators();
    }

    // A site commit may create, change or delete a record, and
    // `operator-remove` drops the email from every site's group in the same
    // commit — both are cheap whole-sheet reloads (there are as many sites
    // as hostnames, not as many as documents).
    // A commit that carries a `Site` trailer may have joined an operator to
    // a group in the same commit as the record it created
    // (`specs/api/admin.md` § Operators).
    if (SITE_ACTIONS.has(action) || action === "operator-remove" || trailers.Site) {
      await this.refreshSites();
    }

    // `doc-operator-add`/`doc-operator-remove` name their document via the
    // `Document` trailer, so the unconditional `if (document) ...reloadDocument`
    // below already covers them. `operator-remove` (`DELETE /operators/:email`)
    // additionally drops the email from every document's `operators` list in
    // the *same* commit, with no per-document `Document` trailer to key off —
    // reload every document the read model knows about instead.
    if (action === "operator-remove") {
      for (const slug of this.documents.keys()) await this.reloadDocument(slug);
    }

    // `specs/data-model.md` § Migrating the pre-site layout: one commit
    // rewrites every pre-site record, with no per-record trailer to key off.
    if (action === "migrate") {
      await this.refreshPeople();
    }

    if (action === "invite") {
      await this.refreshPeople();
      if (document) await this.reloadParticipationsForDocument(document);
    }

    // `send` (invitation blasts, reminders, revision notices), `open`
    // (queues invitations for every pending participation) and
    // `link-export` (`api-core`: marks each exported participation's
    // `notified.links-exported`) all patch several participations in one
    // commit without a per-record `Person` trailer, so the targeted
    // single-record reload below can't find them — refresh the whole
    // document's participations instead.
    if (
      (action === "send" ||
        action === "open" ||
        action === "link-export" ||
        // A `track` flush patches every participation it saw in one commit,
        // naming only the *first* opens in `Opened` — the rest have no
        // trailer to key a targeted reload off either.
        action === "track") &&
      document
    ) {
      await this.reloadParticipationsForDocument(document);
    }

    // Any commit naming this document updates its activity feed, whether or
    // not it touched the document record itself (a sign/comment/submit
    // commit never does, but still belongs in "the record's own event log").
    if (document) await this.reloadDocument(document);

    if (document && person && PARTICIPATION_ACTIONS.has(action)) {
      await this.reloadParticipation(document, person);
    }

    if (document && submission && SUBMISSION_ACTIONS.has(action)) {
      await this.reloadSubmission(document, submission);
    }

    // A publish may set dispositions on submissions from an earlier version
    // (`Disposed: <submission>:<comment>, …`) in the same commit.
    if (document && trailers.Disposed) {
      const ids = new Set(
        trailers.Disposed.split(",")
          .map((ref) => ref.trim().split(":")[0])
          .filter((id): id is string => Boolean(id)),
      );
      for (const id of ids) await this.reloadSubmission(document, id);
    }
  }

  private async refreshLog(): Promise<void> {
    this.fullLog = await logWithTrailers(this.dataDir);
  }

  private async reloadDocument(slug: string): Promise<void> {
    const record = await this.store.documents.queryFirst({ slug });
    if (!record) {
      this.documents.delete(slug);
      return;
    }
    const hydrated = await this.store.documents.loadBody(record);
    await this.computeDocumentEntry(slug, hydrated);
  }

  private async computeDocumentEntry(slug: string, hydrated: DocumentRecord): Promise<void> {
    const relPath = `${SHEET_LOCATIONS.documents.root}/${slug}.${SHEET_LOCATIONS.documents.ext}`;
    // Two ways a commit belongs to this document: it names it in a `Document`
    // trailer (every write this service makes, including the sign/comment
    // commits that never touch the record file), or it changed the record
    // file itself. The second is what catches a teammate's `gitsheets-axi` or
    // hand edit, which carries none of this service's trailers —
    // `specs/behaviors/versioning.md`: "the history is derived from every
    // commit that changed the record's body, not only from the commits this
    // service wrote".
    const touchedRecord = (entry: CommitLogEntry): boolean => entry.paths.includes(relPath);
    const relevant = this.fullLog.filter(
      (entry) => entry.trailers.Document === slug || touchedRecord(entry),
    );

    const versions: DocumentVersion[] = [];
    let previousBody: string | undefined;

    for (const entry of relevant) {
      const action = entry.trailers.Action as Action | undefined;
      // An action that writes the record, or any commit that changed the
      // record file whatever it claims to be. Everything else (a sign, a
      // comment, a submission) cannot have changed the body, so it is skipped
      // without paying for a `git show`.
      if (!((action && DOCUMENT_MUTATING_ACTIONS.has(action)) || touchedRecord(entry))) continue;

      const body = await this.getBodyAtCommit(entry.hash, relPath);
      if (body === null) continue;
      if (body === previousBody) continue;
      // `api-core`: a document is created with an empty body (`admin.md`'s
      // `POST /documents` has no text field — the CLI's `docs create` takes
      // none either; text arrives from the first `versions publish`). An
      // empty body has no text that "changed" in any meaning
      // `specs/behaviors/versioning.md` cares about, so it isn't counted as
      // a version — the first *non-empty* body-changing commit becomes v1,
      // with the real summary the spec expects v1 to carry.
      if (previousBody === undefined && body === "") {
        previousBody = body;
        continue;
      }
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

    // `relevant` is oldest-first (from `fullLog`); activity displays newest-first, capped.
    const activity = relevant.flatMap(expandActivity).reverse().slice(0, ACTIVITY_LIMIT);

    this.documents.set(slug, { record: hydrated, versions, activity });
  }

  private async getBodyAtCommit(hash: string, relPath: string): Promise<string | null> {
    const key = `${hash}:${relPath}`;
    const cached = this.bodyCache.get(key);
    if (cached !== undefined) return cached;

    const raw = await readFileAtCommit(this.dataDir, hash, relPath);
    if (raw === null) return null;

    const { body } = splitFrontmatter(raw);
    this.bodyCache.set(key, body);
    return body;
  }

  private async reloadParticipation(document: string, person: string): Promise<void> {
    const record = await this.store.participations.queryFirst({ document, person });
    const key = participationKey(document, person);
    if (!record) {
      const existing = this.participations.get(key);
      if (existing) this.participationsByToken.delete(existing.record.token);
      this.participations.delete(key);
      return;
    }
    this.setParticipationRecord(record);
    this.computeSignatureEvents(document, person);
  }

  private async reloadParticipationsForDocument(document: string): Promise<void> {
    const records = await this.store.participations.queryAll({ document });
    for (const record of records) this.setParticipationRecord(record);
    for (const record of records) this.computeSignatureEvents(record.document, record.person);
  }

  private setParticipationRecord(record: ParticipationRecord): void {
    const key = participationKey(record.document, record.person);
    const existing = this.participations.get(key);
    if (existing && existing.record.token !== record.token) {
      this.participationsByToken.delete(existing.record.token);
    }
    this.participations.set(key, { record, signatureEvents: existing?.signatureEvents ?? [] });
    this.participationsByToken.set(record.token, key);
  }

  private computeSignatureEvents(document: string, person: string): void {
    const key = participationKey(document, person);
    const entry = this.participations.get(key);
    if (!entry) return;

    const events: SignatureEvent[] = [];
    for (const logEntry of this.fullLog) {
      if (logEntry.trailers.Document !== document || logEntry.trailers.Person !== person) continue;
      const action = logEntry.trailers.Action as Action | undefined;
      if (!action) continue;
      const signatureTrailer = logEntry.trailers.Signature;
      const eventAction = SIGNATURE_ACTIONS.has(action)
        ? (action as SignatureEvent["action"])
        : signatureTrailer && SIGNATURE_TRAILER_ACTIONS.has(signatureTrailer)
          ? (signatureTrailer as SignatureEvent["action"])
          : null;
      if (!eventAction) continue;
      const version = Number.parseInt(logEntry.trailers.Version ?? "", 10);
      events.push({
        action: eventAction,
        at: logEntry.committerDate,
        actor: logEntry.trailers.Actor ?? logEntry.authorName,
        commit: logEntry.hash,
        reason: logEntry.trailers.Reason,
        version: Number.isNaN(version) ? undefined : version,
      });
    }
    entry.signatureEvents = events;
  }

  private async reloadSubmission(document: string, id: string): Promise<void> {
    const record = await this.store.submissions.queryFirst({ document, id });
    const key = submissionKey(document, id);
    if (!record) {
      this.submissions.delete(key);
      return;
    }
    this.setSubmissionRecord(record);
    this.computeSubmissionTiming(document, id);
    this.recomputePosition(document, record.person);
  }

  private setSubmissionRecord(record: SubmissionRecord): void {
    const key = submissionKey(record.document, record.id);
    const existing = this.submissions.get(key);
    this.submissions.set(key, { record, timing: existing?.timing ?? { savedAt: [] } });
  }

  private computeSubmissionTiming(document: string, id: string): void {
    const key = submissionKey(document, id);
    const entry = this.submissions.get(key);
    if (!entry) return;

    const timing: SubmissionTiming = { savedAt: [] };
    for (const logEntry of this.fullLog) {
      if (logEntry.trailers.Document !== document || logEntry.trailers.Submission !== id) continue;
      const action = logEntry.trailers.Action as Action | undefined;
      if (timing.startedAt === undefined) timing.startedAt = logEntry.committerDate;
      if (action === "comment") timing.savedAt.push(logEntry.committerDate);
      if (action === "submit") timing.submittedAt = logEntry.committerDate;
    }
    entry.timing = timing;
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

  private recomputeAllPositions(): void {
    this.positions.clear();
    for (const entry of this.submissions.values()) {
      this.recomputePosition(entry.record.document, entry.record.person);
    }
  }

  // --- Accessors ---

  getDocument(slug: string): DocumentEntry | undefined {
    return this.documents.get(slug);
  }

  listDocuments(): DocumentEntry[] {
    return [...this.documents.values()];
  }

  /**
   * Every activity entry for one document since `sinceIso`, oldest first
   * and uncapped — `DocumentEntry.activity` is the dashboard's last-50
   * view, and the operator digest needs a window instead
   * (`specs/behaviors/notifications.md` § Operator digest). Served from the
   * same in-memory log, so it costs a filter and no git.
   */
  listActivitySince(slug: string, sinceIso: string): ActivityEntry[] {
    // `%cI` carries the committer's own offset, so these are compared as
    // instants rather than as strings.
    const since = new Date(sinceIso).getTime();
    return this.fullLog
      .filter(
        (entry) =>
          entry.trailers.Document === slug && new Date(entry.committerDate).getTime() >= since,
      )
      .flatMap(expandActivity);
  }

  /**
   * `specs/behaviors/sites.md` § People are per site: a person is identified
   * by their site **and** their id — the same slug may name a different
   * person on another site — so there is deliberately no lookup by id alone.
   */
  getPerson(site: string, id: string): PersonRecord | undefined {
    return this.people.get(personKey(site, id));
  }

  /**
   * The person a participation names, resolved through the **document's**
   * site rather than the caller's standing ("the scope follows the
   * document"). Every call site already holds a document slug, so this is
   * the form they use; an unknown document resolves against the default
   * site, which is what a document with no `site` field means anyway.
   */
  getPersonOn(documentSlug: string, personId: string): PersonRecord | undefined {
    return this.getPerson(this.siteSlugForDocument(documentSlug), personId);
  }

  /** The slug of the site a document belongs to; `default` when it names none. */
  siteSlugForDocument(documentSlug: string): string {
    return this.documents.get(documentSlug)?.record.site ?? DEFAULT_SITE_SLUG;
  }

  /** Every person on one site — the only listing scope there is. */
  listPeopleForSite(site: string): PersonRecord[] {
    return [...this.people.values()].filter((person) => person.site === site);
  }

  /** Case-insensitive — every operator lookup keys off the lowercase email. */
  getOperatorByEmail(email: string): OperatorRecord | undefined {
    const id = this.operatorsByEmail.get(email.toLowerCase());
    return id ? this.operators.get(id) : undefined;
  }

  getSite(slug: string): SiteRecord | undefined {
    return this.sites.get(slug);
  }

  /** Exact, case-insensitive hostname match — no wildcards, no suffixes (`specs/behaviors/sites.md`). */
  getSiteByHostname(hostname: string): SiteRecord | undefined {
    const slug = this.sitesByHostname.get(hostname.toLowerCase());
    return slug ? this.sites.get(slug) : undefined;
  }

  listSites(): SiteRecord[] {
    return [...this.sites.values()];
  }

  listOperators(): OperatorRecord[] {
    return [...this.operators.values()];
  }

  operatorCount(): number {
    return this.operators.size;
  }

  getParticipation(document: string, person: string): ParticipationEntry | undefined {
    return this.participations.get(participationKey(document, person));
  }

  /** Every participation for one document — invitations lists, signatures lists, notification fan-out. */
  listParticipationsForDocument(document: string): ParticipationEntry[] {
    return [...this.participations.values()].filter((entry) => entry.record.document === document);
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
  summary(): {
    documents: number;
    operators: number;
    people: number;
    participations: number;
    submissions: number;
    sites: number;
  } {
    return {
      documents: this.documents.size,
      operators: this.operators.size,
      people: this.people.size,
      participations: this.participations.size,
      submissions: this.submissions.size,
      sites: this.sites.size,
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
