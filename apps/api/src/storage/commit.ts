import {
  type Action,
  type DeadlineChange,
  formatDeadlinesTrailer,
  type Judgement,
  type SignatureTrailer,
  type Trailers,
} from "@community-drafter/shared";
import type { StoreTx } from "gitsheets";

import { actorIdentity, actorTrailerValue, type Actor } from "./actor.ts";
import type { DataStore, validators } from "./schemas.ts";

export type DataStoreTx = StoreTx<typeof validators>;

/**
 * Everything a caller supplies for one `specs/data-model.md` "Commits are
 * the events" commit, besides the mutation itself. `subject` is the human
 * sentence (`sign: jane-doe on coalition-charter`, …); the rest map 1:1 to
 * trailers, included only when set — which ones apply depends on `action`
 * per the table in the spec, and that shaping is the caller's job (routes,
 * in a later plan). This wrapper's job is just: stamp them consistently,
 * derive author/committer from `actor`, and commit atomically.
 */
export interface CommitInput {
  actor: Actor;
  subject: string;
  document?: string;
  person?: string;
  version?: number;
  summary?: string;
  final?: boolean;
  notes?: string;
  submission?: string;
  judgement?: Judgement;
  /**
   * `specs/data-model.md` → `Signature` trailer: set on a `submit` commit
   * that also writes the participation's `signature` table, so comment-mode
   * signing reads back as the same sign/resign/revoke event as the sign card.
   */
  signature?: SignatureTrailer;
  disposed?: string;
  /**
   * The deadlines an `extend`/`reopen` moved, with what they moved from —
   * `specs/screens/admin-dashboard.md` § Recent activity shows the literal
   * old and new times, and the commit is the only place they are recorded.
   */
  deadlines?: DeadlineChange[];
  reason?: string;
  requestId?: string;
}

export interface CommitResult<T> {
  value: T;
  commitHash: string | null;
  trailers: Trailers;
}

function buildTrailers(action: Action, input: CommitInput): Trailers {
  const trailers: Trailers = {
    Action: action,
    Actor: actorTrailerValue(input.actor),
  };
  if (input.document !== undefined) trailers.Document = input.document;
  if (input.person !== undefined) trailers.Person = input.person;
  if (input.version !== undefined) trailers.Version = input.version;
  if (input.summary !== undefined) trailers.Summary = input.summary;
  if (input.final) trailers.Final = "true";
  if (input.notes !== undefined) trailers.Notes = input.notes;
  if (input.submission !== undefined) trailers.Submission = input.submission;
  if (input.judgement !== undefined) trailers.Judgement = input.judgement;
  if (input.signature !== undefined) trailers.Signature = input.signature;
  if (input.disposed !== undefined) trailers.Disposed = input.disposed;
  if (input.deadlines !== undefined) {
    const deadlines = formatDeadlinesTrailer(input.deadlines);
    if (deadlines !== undefined) trailers.Deadlines = deadlines;
  }
  if (input.reason !== undefined) trailers.Reason = input.reason;
  if (input.requestId !== undefined) trailers["Request-Id"] = input.requestId;
  return trailers;
}

function toGitTrailers(trailers: Trailers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(trailers)) {
    if (value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

/**
 * `commit(store, action, input, fn)` — one `repo.transact` (via `store.transact`
 * so `tx.documents` / `tx.people` / … are typed) whose author/committer come
 * from `input.actor` and whose trailers are the full `specs/data-model.md`
 * set built from `action` + `input`. Commits only when `fn` stages a
 * mutation (gitsheets' commit-on-success-only rule) — `commitHash` is `null`
 * on a no-op transaction.
 */
export async function commit<T>(
  store: DataStore,
  action: Action,
  input: CommitInput,
  fn: (tx: DataStoreTx) => Promise<T>,
): Promise<CommitResult<T>> {
  const trailers = buildTrailers(action, input);
  const identity = actorIdentity(input.actor);

  const result = await store.transact(
    {
      message: input.subject,
      author: identity,
      committer: identity,
      trailers: toGitTrailers(trailers),
    },
    fn,
  );

  return { value: result.value, commitHash: result.commitHash, trailers };
}
