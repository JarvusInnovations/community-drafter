import { Link } from "react-router";

import { useParticipantBundle } from "./BundleContext.tsx";
import { copy } from "./copy.ts";

/**
 * `/i/:token/comment` — a placeholder. The `comment-mode` plan owns this
 * route's real content (`plans/participant-sign-flow.md` § Scope: "Out:
 * comment mode"); this exists so the sign card's "I have comments first" /
 * "Add comments" / "Continue" links aren't dead.
 */
export function CommentPlaceholder(): JSX.Element {
  const { token } = useParticipantBundle();
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">{copy.commentPlaceholder.heading}</h1>
      <p className="text-muted-foreground">{copy.commentPlaceholder.body}</p>
      <Link to={`/i/${token}`} className="underline">
        {copy.commentPlaceholder.back}
      </Link>
    </main>
  );
}
