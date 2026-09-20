import { Link } from "react-router";

import { useParticipantBundle } from "./BundleContext.tsx";
import { copy } from "./copy.ts";
import { formatAbsolute } from "./format.ts";

/** `/i/:token/history` — `specs/screens/version-history.md` § Display Rules "List". */
export function HistoryScreen(): JSX.Element {
  const { bundle, token } = useParticipantBundle();
  const currentNumber = bundle.version.number;
  const versions = bundle.versions.toSorted((a, b) => b.number - a.number);

  return (
    <main className="mx-auto max-w-[760px] px-5 py-6 pb-10">
      <p className="mb-2">
        <Link to={`/i/${token}`} className="text-sm font-medium text-primary hover:underline">
          {copy.history.backToDocument}
        </Link>
      </p>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        {copy.history.title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{copy.history.explainer}</p>

      <ul className="mt-4 flex flex-col gap-3">
        {versions.map((version) => (
          <li key={version.number} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">
              {copy.submissions.versionLabel(version.number)} ·{" "}
              {formatAbsolute(version.published_at)}
              {version.number === currentNumber ? (
                <span className="ml-2 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-bold text-ok">
                  {copy.history.current}
                </span>
              ) : null}
              {version.final ? (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                  {copy.history.finalBadge}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-foreground italic">{version.summary}</p>
            {version.dispositions > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {copy.history.answeredComments(version.dispositions)}
              </p>
            ) : null}
            <div className="mt-2 flex gap-3 text-sm">
              <Link
                to={
                  version.number === currentNumber
                    ? `/i/${token}`
                    : `/i/${token}/v/${version.number}`
                }
                className="font-medium text-primary hover:underline"
              >
                {copy.history.read}
              </Link>
              {version.number > 1 ? (
                <Link
                  to={`/i/${token}/history/compare?from=${version.number - 1}&to=${version.number}`}
                  className="font-medium text-primary hover:underline"
                >
                  {copy.history.compareWithPrevious}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
