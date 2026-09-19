import { Link } from "react-router";

import { useParticipantBundle } from "./BundleContext.tsx";
import { copy } from "./copy.ts";

/**
 * `/i/:token/prefs` — a placeholder. The `notifications` plan owns this
 * route's real content (`plans/participant-sign-flow.md` § Scope: "Out:
 * preferences page"); this exists so the footer's "Manage how we contact
 * you" link isn't dead.
 */
export function PrefsPlaceholder(): JSX.Element {
  const { token } = useParticipantBundle();
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">{copy.prefsPlaceholder.heading}</h1>
      <p className="text-muted-foreground">{copy.prefsPlaceholder.body}</p>
      <Link to={`/i/${token}`} className="underline">
        {copy.prefsPlaceholder.back}
      </Link>
    </main>
  );
}
