import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * `specs/behaviors/versioning.md` § Citations. The web offers two of the
 * three modes as a reader control — `hybrid` is the deliverable's mode and
 * is honored when a URL names it, but the toggle itself is "Sources as
 * footnotes" on or off.
 */
export type CitationsMode = "links" | "footnotes" | "hybrid";

const MODES = new Set<string>(["links", "footnotes", "hybrid"]);
const STORAGE_KEY = "signatories:citations";

function isMode(value: string | null | undefined): value is CitationsMode {
  return value !== null && value !== undefined && MODES.has(value);
}

/**
 * Reading the remembered preference must never be able to break the page:
 * private browsing, blocked site data and a sandboxed frame all throw on
 * access rather than returning null (`specs/screens/document.md` § Display
 * Rules 5: "the page renders correctly when neither is available").
 */
function readStored(): CitationsMode | undefined {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isMode(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(mode: CitationsMode): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, mode);
  } catch {
    // A reader whose browser refuses storage simply gets no memory of the
    // choice; the choice itself still applies for this page.
  }
}

/**
 * The reader's citation mode for this page (`specs/screens/document.md` §
 * Display Rules 5). `?citations=` wins over what was remembered, so a
 * reader can hand someone the exact form they are looking at; absent both,
 * the default is `links`.
 *
 * Setting the mode writes both: the URL (replacing, not pushing — a
 * display preference is not a place in history to go Back to) and the
 * per-reader memory.
 */
export function useCitationsMode(): {
  mode: CitationsMode;
  sourcesShown: boolean;
  setSourcesShown: (shown: boolean) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get("citations");
  const [remembered, setRemembered] = useState<CitationsMode | undefined>(undefined);

  // Read after mount, never during render: the value is per-browser, and a
  // first paint that matches the URL alone is the one every reader shares.
  useEffect(() => {
    setRemembered(readStored());
  }, []);

  const mode: CitationsMode = isMode(fromUrl) ? fromUrl : (remembered ?? "links");

  const setSourcesShown = (shown: boolean): void => {
    const next: CitationsMode = shown ? "footnotes" : "links";
    writeStored(next);
    setRemembered(next);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.set("citations", next);
        return params;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  return { mode, sourcesShown: mode !== "links", setSourcesShown };
}

/**
 * The document's HTML in the reader's citation mode. `links` is what the
 * bundle already carries, so the common case costs nothing; any other mode
 * fetches that one version's HTML again and shows the mode it has until the
 * new one arrives, so the text never blanks out mid-read.
 *
 * A failed fetch falls back to what is already on screen. The worst case is
 * a reader who asked for footnotes and keeps links — legible either way.
 */
export function useCitedHtml(
  html: string,
  mode: CitationsMode,
  fetchHtml: (mode: CitationsMode) => Promise<string>,
): string {
  const [alternate, setAlternate] = useState<{ mode: CitationsMode; html: string } | null>(null);

  useEffect(() => {
    if (mode === "links") {
      setAlternate(null);
      return;
    }
    let cancelled = false;
    void fetchHtml(mode)
      .then((next) => {
        if (!cancelled) {
          setAlternate({ mode, html: next });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlternate(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // `fetchHtml` is rebuilt on every render by its callers; the identity of
    // the document being read is `html` plus the mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, html]);

  if (mode === "links") {
    return html;
  }
  return alternate?.mode === mode ? alternate.html : html;
}
