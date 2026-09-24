import { useCallback } from "react";
import { Link } from "react-router";

import { getCompare } from "./api.ts";
import { useParticipantBundle } from "./BundleContext.tsx";
import { type CompareVariant, CompareView } from "./components/CompareView.tsx";
import { copy } from "./copy.ts";

const PARTICIPANT_COMPARE: CompareVariant = {
  heading: "h1",
  headingClass: "text-2xl font-extrabold tracking-tight text-foreground",
  selectClass: "rounded-lg border border-border bg-card px-2 py-1",
  bodyClass: "doc-body mt-4 rounded-2xl border border-border bg-card p-5",
};

/**
 * `/i/:token/history/compare` — `specs/screens/version-history.md` §
 * Display Rules "Compare". The comparison itself, URL state included, is
 * `CompareView`, shared with the public and admin compare screens.
 */
export function CompareScreen(): JSX.Element {
  const { bundle, token } = useParticipantBundle();
  const fetchCompare = useCallback(
    (from: number, to: number) => getCompare(token, from, to),
    [token],
  );

  return (
    <main className="mx-auto max-w-[760px] px-5 py-6 pb-10">
      <CompareView
        currentNumber={bundle.version.number}
        versionNumbers={bundle.versions.map((v) => v.number)}
        fetchCompare={fetchCompare}
        variant={PARTICIPANT_COMPARE}
        back={
          <Link
            to={`/i/${token}/history`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {copy.history.title}
          </Link>
        }
      />
    </main>
  );
}
