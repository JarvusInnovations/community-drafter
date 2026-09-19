/**
 * `specs/data-model.md` → `Actor` trailer: "admin email, `cli:<label>`, or
 * `participant`". This module is the single place that turns a request's
 * principal into both the trailer string and the git author/committer
 * identity used for the commit.
 */
export type Actor =
  | { kind: "admin"; email: string }
  | { kind: "cli"; label: string }
  | { kind: "participant" };

export interface GitIdentity {
  name: string;
  email: string;
}

const PARTICIPANT_IDENTITY: GitIdentity = {
  name: "Participant",
  email: "participant@community-drafter.local",
};

/** The exact string that lands in the `Actor` trailer. */
export function actorTrailerValue(actor: Actor): string {
  switch (actor.kind) {
    case "admin":
      return actor.email;
    case "cli":
      return `cli:${actor.label}`;
    case "participant":
      return "participant";
  }
}

/** The git author/committer identity for the commit this actor makes. */
export function actorIdentity(actor: Actor): GitIdentity {
  switch (actor.kind) {
    case "admin":
      return { name: actor.email, email: actor.email };
    case "cli":
      return { name: `cli:${actor.label}`, email: `cli+${actor.label}@community-drafter.local` };
    case "participant":
      return PARTICIPANT_IDENTITY;
  }
}
