import { Link } from "react-router";

import { copy } from "./copy.ts";
import { usePublicBundle } from "./PublicBundleContext.tsx";
import { formatAbsolute } from "../participant/format.ts";

/**
 * `/d/:slug/history` — the public equivalent of
 * `../participant/HistoryScreen.tsx`. No per-version "Read" link: unlike
 * `/i/:token/v/:n`, there is no public single-older-version route
 * (`specs/screens/public-and-embed.md`'s route table), only the current
 * version plus compare-with-previous.
 */
export function HistoryScreen(): JSX.Element {
  const { bundle, slug } = usePublicBundle();
  const currentNumber = bundle.version.number;
  const versions = bundle.versions.toSorted((a, b) => b.number - a.number);

  return (
    <main className="px-4 py-4 pb-8">
      <p className="mb-2">
        <Link to={`/d/${slug}`} className="text-sm underline">
          {copy.history.backToDocument}
        </Link>
      </p>
      <h1 className="text-xl font-semibold text-foreground">{copy.history.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{copy.history.explainer}</p>

      <ul className="mt-4 flex flex-col gap-3">
        {versions.map((version) => (
          <li key={version.number} className="rounded border border-border p-3">
            <p className="text-sm font-semibold text-foreground">
              {copy.submissions.versionLabel(version.number)} ·{" "}
              {formatAbsolute(version.published_at)}
              {version.number === currentNumber ? (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                  {copy.history.current}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-foreground italic">{version.summary}</p>
            {version.dispositions > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {copy.history.answeredComments(version.dispositions)}
              </p>
            ) : null}
            {version.number > 1 ? (
              <div className="mt-2 flex gap-3 text-sm">
                <Link
                  to={`/d/${slug}/history/compare?from=${version.number - 1}&to=${version.number}`}
                  className="underline"
                >
                  {copy.history.compareWithPrevious}
                </Link>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
