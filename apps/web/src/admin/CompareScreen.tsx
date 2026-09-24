import { useCallback } from "react";
import { Link } from "react-router";

import { getCompare } from "./api.ts";
import { copy } from "./copy.ts";
import { useAdminDocument } from "./DocumentContext.tsx";
import { quietLinkClass, selectClass } from "./styles.ts";
import { type CompareVariant, CompareView } from "../participant/components/CompareView.tsx";

/**
 * The admin frame already carries the page's one `h1` (the document title
 * above the tabs), so the comparison's title sits one level down.
 */
const ADMIN_COMPARE: CompareVariant = {
  heading: "h2",
  headingClass: "text-lg font-bold tracking-tight text-foreground",
  selectClass,
  bodyClass: "doc-body mt-4 rounded-2xl border border-border bg-card p-5",
};

/**
 * `/admin/d/:slug/versions/compare` — `specs/screens/admin-dashboard.md` §
 * Versions "Compare": the participant comparison
 * (`specs/screens/version-history.md` § Compare) inside the admin frame,
 * over the admin compare endpoint.
 */
export function CompareScreen(): JSX.Element {
  const { document } = useAdminDocument();
  const slug = document.slug;
  const fetchCompare = useCallback(
    (from: number, to: number) => getCompare(slug, from, to),
    [slug],
  );
  const versionNumbers = document.versions.map((v) => v.number);
  const currentNumber = versionNumbers.reduce((max, n) => Math.max(max, n), 0);

  return (
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <CompareView
        currentNumber={currentNumber}
        versionNumbers={versionNumbers}
        fetchCompare={fetchCompare}
        variant={ADMIN_COMPARE}
        back={
          <Link to={`/admin/d/${slug}/versions`} className={quietLinkClass}>
            {copy.versions.backToVersions}
          </Link>
        }
      />
    </main>
  );
}
