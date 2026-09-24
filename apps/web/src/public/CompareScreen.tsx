import { useCallback } from "react";
import { Link } from "react-router";

import { getPublicCompare } from "./api.ts";
import { copy } from "./copy.ts";
import { usePublicBundle } from "./PublicBundleContext.tsx";
import { type CompareVariant, CompareView } from "../participant/components/CompareView.tsx";

const PUBLIC_COMPARE: CompareVariant = {
  heading: "h1",
  headingClass: "text-xl font-semibold text-foreground",
  selectClass: "rounded border border-border p-1",
  bodyClass: "doc-body mt-4",
};

/**
 * `/d/:slug/history/compare` — the public equivalent of
 * `../participant/CompareScreen.tsx`, over the same `CompareView`.
 */
export function CompareScreen(): JSX.Element {
  const { bundle, slug } = usePublicBundle();
  const fetchCompare = useCallback(
    (from: number, to: number) => getPublicCompare(slug, from, to),
    [slug],
  );

  return (
    <main className="px-4 py-4 pb-8">
      <CompareView
        currentNumber={bundle.version.number}
        versionNumbers={bundle.versions.map((v) => v.number)}
        fetchCompare={fetchCompare}
        variant={PUBLIC_COMPARE}
        back={
          <Link to={`/d/${slug}/history`} className="text-sm underline">
            {copy.history.title}
          </Link>
        }
      />
    </main>
  );
}
