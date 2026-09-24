import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { copy } from "../copy.ts";
import { type CompareResult } from "../types.ts";

const HIDE_UNCHANGED_THRESHOLD = 30;

type CompareState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "same" }
  | { status: "ready"; result: CompareResult };

/**
 * The frame a compare screen sits in. The redline itself — its markup, its
 * summary line, its legend — is the same everywhere; only these classes
 * differ, so the participant, public and admin screens each keep their own
 * look (`specs/screens/admin-dashboard.md` § Versions: the team reads
 * exactly the redline its participants read).
 */
export interface CompareVariant {
  heading: "h1" | "h2";
  headingClass: string;
  selectClass: string;
  bodyClass: string;
}

export interface CompareViewProps {
  /** The version `to` defaults to: the current one. */
  currentNumber: number;
  versionNumbers: number[];
  /**
   * Fetches the server-computed redline. Must be stable across renders
   * (`useCallback`), since a new function refetches.
   */
  fetchCompare: (from: number, to: number) => Promise<CompareResult>;
  /** The link back to the version list, rendered above the heading. */
  back: ReactNode;
  variant: CompareVariant;
}

/**
 * The comparison screen body — `specs/screens/version-history.md` § Display
 * Rules "Compare". `from`/`to`/`hide_unchanged` all live in the URL
 * (`jarvus-react` § Quality Baseline: "shareable filters ... in the URL") so
 * the comparison is shareable, per the screen spec's Actions. Shared by the
 * participant, public and admin compare screens.
 */
export function CompareView({
  currentNumber,
  versionNumbers,
  fetchCompare,
  back,
  variant,
}: CompareViewProps): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  const to = searchParams.has("to") ? Number(searchParams.get("to")) : currentNumber;
  const from = searchParams.has("from") ? Number(searchParams.get("from")) : Math.max(1, to - 1);

  const [state, setState] = useState<CompareState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (from === to) {
      setState({ status: "same" });
      return () => {
        cancelled = true;
      };
    }
    setState({ status: "loading" });
    fetchCompare(from, to)
      .then((result) => {
        if (!cancelled) {
          setState({ status: "ready", result });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchCompare, from, to]);

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

  const sortedNumbers = versionNumbers.toSorted((a, b) => a - b);
  const Heading = variant.heading;

  return (
    <>
      <p className="mb-2">{back}</p>
      <Heading className={variant.headingClass}>{copy.compare.title(from, to)}</Heading>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          {copy.compare.fromLabel}
          <select
            value={from}
            onChange={(event) => updateParams({ from: event.target.value })}
            className={variant.selectClass}
          >
            {sortedNumbers.map((n) => (
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
            className={variant.selectClass}
          >
            {sortedNumbers.map((n) => (
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
            {copy.compare.summary(state.result.summary.items)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{copy.compare.legend}</p>

          {blocks.length === 0 ? (
            <p className="mt-4 text-muted-foreground">{copy.compare.noChanges}</p>
          ) : (
            <div className={variant.bodyClass}>
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
    </>
  );
}
