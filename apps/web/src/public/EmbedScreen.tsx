import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import { getPublicBundle } from "./api.ts";
import { copy } from "./copy.ts";
import { type PublicBundle } from "./types.ts";
import { DocumentBody } from "../participant/components/DocumentBody.tsx";
import { formatAbsolute } from "../participant/format.ts";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; bundle: PublicBundle };

/**
 * `specs/screens/public-and-embed.md` § Display Rules "Embed": "Height
 * reported to the parent via `postMessage` so hosts can size the frame."
 * Reports once the content is ready, then again on every window resize and
 * on any change to the reported element's own size (a `ResizeObserver` —
 * covers reflow from web-font swap or a slow image, not just the viewport
 * changing) — `plans/public-and-embed.md`'s "on load and resize".
 * `ResizeObserver` is guarded for test environments that don't implement it.
 */
function useHeightReporting(active: boolean): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    const node = ref.current;
    if (!node) {
      return;
    }

    function report() {
      if (!node) {
        return;
      }
      window.parent.postMessage({ type: "drafter:height", height: node.scrollHeight }, "*");
    }

    report();
    window.addEventListener("resize", report);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(report);
      observer.observe(node);
    }

    return () => {
      window.removeEventListener("resize", report);
      observer?.disconnect();
    };
  }, [active]);

  return ref;
}

/**
 * `/d/:slug/embed` — "title, version label ... the document text, a
 * footer line 'Read the full page' ... No signatory list, no clock (the
 * host page owns that context)." Fetches its own bundle rather than
 * nesting under `PublicLayout`: this route renders no shared chrome and
 * must stay as small as the rest of the public bundle allows.
 */
export function EmbedScreen(): JSX.Element | null {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const ref = useHeightReporting(state.status === "ready");

  useEffect(() => {
    if (!slug) {
      return;
    }
    let cancelled = false;
    getPublicBundle(slug)
      .then((bundle) => {
        if (!cancelled) {
          setState({ status: "ready", bundle });
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
  }, [slug]);

  if (!slug || state.status === "error") {
    return <main className="p-4 text-sm text-muted-foreground">{copy.notFound.heading}</main>;
  }

  if (state.status === "loading") {
    return <main className="p-4 text-sm text-muted-foreground">{copy.loading}</main>;
  }

  const { bundle } = state;

  return (
    <div ref={ref} className="p-4">
      <h1 className="text-xl font-bold text-foreground">{bundle.document.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {copy.versionLabel.line(
          bundle.version.number,
          formatAbsolute(bundle.version.published_at),
          bundle.version.summary,
        )}{" "}
        ·{" "}
        <a href={`/d/${slug}/history`} target="_blank" rel="noreferrer" className="underline">
          {copy.versionLabel.seeWhatChanged}
        </a>
      </p>
      <DocumentBody html={bundle.version.html} />
      <footer className="mt-4 border-t border-border pt-2 text-sm">
        <a href={`/d/${slug}`} target="_blank" rel="noreferrer" className="underline">
          {copy.embed.readFullPage}
        </a>
      </footer>
    </div>
  );
}
