import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { ApiError, getCompare } from "./api.ts";
import { useParticipantBundle } from "./BundleContext.tsx";
import { copy } from "./copy.ts";
import { type CompareResult } from "./types.ts";

const HIDE_UNCHANGED_THRESHOLD = 30;

/**
 * `/i/:token/history/compare` — `specs/screens/version-history.md` §
 * Display Rules "Compare". `from`/`to`/`hide_unchanged` all live in the URL
 * (`jarvus-react` § Quality Baseline: "shareable filters ... in the URL")
 * so the comparison is shareable within the same link, per the screen
 * spec's Actions.
 */
export function CompareScreen(): JSX.Element {
  const { bundle, token } = useParticipantBundle();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentNumber = bundle.version.number;
  const to = searchParams.has("to") ? Number(searchParams.get("to")) : currentNumber;
  const from = searchParams.has("from") ? Number(searchParams.get("from")) : Math.max(1, to - 1);

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; error: ApiError }
    | { status: "same" }
    | { status: "ready"; result: CompareResult }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (from === to) {
      setState({ status: "same" });
      return () => {
        cancelled = true;
      };
    }
    setState({ status: "loading" });
    getCompare(token, from, to)
      .then((result) => {
        if (!cancelled) {
          setState({ status: "ready", result });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          error:
            err instanceof ApiError
              ? err
              : new ApiError(500, "internal_error", copy.genericError, {}),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, from, to]);

  const blocks = state.status === "ready" ? state.result.blocks : [];
  const hideParam = searchParams.get("hide_unchanged");
  const hideUnchanged =
    hideParam !== null ? hideParam === "1" : blocks.length > HIDE_UNCHANGED_THRESHOLD;

  function updateParams(patch: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  const versionNumbers = bundle.versions.map((v) => v.number).toSorted((a, b) => a - b);

  return (
    <main className="px-4 py-4 pb-8">
      <p className="mb-2">
        <Link to={`/i/${token}/history`} className="text-sm underline">
          {copy.history.title}
        </Link>
      </p>
      <h1 className="text-xl font-semibold text-foreground">{copy.compare.title(from, to)}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          {copy.compare.fromLabel}
          <select
            value={from}
            onChange={(event) => updateParams({ from: event.target.value })}
            className="rounded border border-border p-1"
          >
            {versionNumbers.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          {copy.compare.toLabel}
          <select
            value={to}
            onChange={(event) => updateParams({ to: event.target.value })}
            className="rounded border border-border p-1"
          >
            {versionNumbers.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={hideUnchanged}
            onChange={(event) => updateParams({ hide_unchanged: event.target.checked ? "1" : "0" })}
          />
          {copy.compare.hideUnchanged}
        </label>
      </div>

      {state.status === "ready" ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {copy.compare.summary(
              state.result.summary.changed,
              state.result.summary.added,
              state.result.summary.removed,
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{copy.compare.legend}</p>

          {blocks.length === 0 ? (
            <p className="mt-4 text-muted-foreground">{copy.compare.noChanges}</p>
          ) : (
            <div className="doc-body mt-4">
              {blocks
                .filter((block) => !(hideUnchanged && block.status === "same"))
                .map((block) => (
                  // Server-sanitized redline HTML (`specs/architecture.md` §
                  // API server: diffs are computed and rendered server-side).
                  <div
                    key={block.id}
                    data-status={block.status}
                    className="diff-block"
                    dangerouslySetInnerHTML={{ __html: block.html }}
                  />
                ))}
            </div>
          )}
        </>
      ) : state.status === "loading" ? (
        <p className="mt-4 text-muted-foreground">{copy.loading}</p>
      ) : state.status === "same" ? (
        <p className="mt-4 text-muted-foreground">{copy.compare.sameVersion}</p>
      ) : (
        <p role="alert" className="mt-4 text-destructive">
          {copy.genericError}
        </p>
      )}
    </main>
  );
}
