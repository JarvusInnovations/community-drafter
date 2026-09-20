/**
 * `specs/data-model.md` → `Actor` trailer: "an operator's email, `participant`,
 * or `system` (bootstrap)". This module is the single place that turns a
 * request's principal into both the trailer string and the git
 * author/committer identity used for the commit.
 *
 * Operators replace the old admin/cli split (`plans/operators-auth.md`):
 * both a human's cookie session and a CLI/bot's bearer token resolve to the
 * same `operator` actor kind, keyed by email — there is no separate
 * `cli:<label>` form and no `X-Actor` override.
 */
export type Actor =
  | { kind: "operator"; email: string }
  | { kind: "participant" }
  | { kind: "system" };

export interface GitIdentity {
  name: string;
  email: string;
}

const PARTICIPANT_IDENTITY: GitIdentity = {
  name: "Participant",
  email: "participant@community-drafter.local",
};

const SYSTEM_IDENTITY: GitIdentity = {
  name: "system",
  email: "system@community-drafter.local",
};

/** The exact string that lands in the `Actor` trailer. */
export function actorTrailerValue(actor: Actor): string {
  switch (actor.kind) {
    case "operator":
      return actor.email;
    case "participant":
      return "participant";
    case "system":
      return "system";
  }
}

/** The git author/committer identity for the commit this actor makes. */
export function actorIdentity(actor: Actor): GitIdentity {
  switch (actor.kind) {
    case "operator":
      return { name: actor.email, email: actor.email };
    case "participant":
      return PARTICIPANT_IDENTITY;
    case "system":
      return SYSTEM_IDENTITY;
  }
}
