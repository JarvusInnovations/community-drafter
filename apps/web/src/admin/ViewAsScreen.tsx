import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { ApiError, getViewAsBundle } from "./api.ts";
import { copy } from "./copy.ts";
import { DocumentView } from "../participant/components/DocumentView.tsx";
import { type Bundle } from "../participant/types.ts";

/** `DocumentView` requires a `refetch`; view-as never calls it (every control is disabled). */
async function noop(): Promise<void> {}

/**
 * `/admin/d/:slug/view-as/:person` — `specs/screens/admin-dashboard.md` §
 * "View as": "renders the participant document screen for that person
 * read-only with a persistent banner ... Every action control is
 * disabled." Reuses the participant `DocumentView` with `readOnly` rather
 * than a parallel admin-only render, so the two can never drift.
 */
export function ViewAsScreen(): JSX.Element {
  const { slug, person } = useParams<{ slug: string; person: string }>();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !person) {
      return;
    }
    getViewAsBundle(slug, person)
      .then((result) => setBundle(result as Bundle))
      .catch((err) => setError(err instanceof ApiError ? err.message : copy.genericError));
  }, [slug, person]);

  if (error) {
    return (
      <main className="mx-auto max-w-[1120px] px-5 py-6 text-destructive" role="alert">
        {error}
      </main>
    );
  }
  if (!bundle) {
    return (
      <main className="mx-auto max-w-[1120px] px-5 py-6 text-muted-foreground">{copy.loading}</main>
    );
  }

  return (
    <div>
      <div
        role="status"
        className="sticky top-0 z-10 border-b-2 border-amber bg-amber-soft px-4 py-2 text-center text-sm font-bold text-amber"
      >
        {copy.viewAs.banner(bundle.person.name)}
      </div>
      <DocumentView
        bundle={bundle}
        token=""
        refetch={noop}
        version={bundle.version}
        isCurrent
        readOnly
      />
    </div>
  );
}
