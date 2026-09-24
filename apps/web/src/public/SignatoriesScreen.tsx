import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { ApiError, getPublicBundle } from "./api.ts";
import { copy } from "./copy.ts";
import { type PublicBundle } from "./types.ts";
import { Signatories } from "../participant/components/Signatories.tsx";
import { formatAbsolute } from "../participant/format.ts";
import { NotFoundScreen } from "../participant/NotFoundScreen.tsx";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; bundle: PublicBundle };

/**
 * `/d/:slug/signatories` — a minimal-chrome, frameable page/fragment
 * (`specs/screens/public-and-embed.md` § Display Rules): the counts line,
 * then the ordered list the API already returns (organizations first,
 * alphabetically; then individuals, chronologically), the unlisted-count
 * footnote, and a last-updated time. Fetches its own bundle rather than
 * nesting under `PublicLayout` because it's embeddable on its own, exactly
 * like `EmbedScreen`, and must render without the frame — which is not the
 * same as without the design (`specs/screens/public-and-embed.md`).
 */
export function SignatoriesScreen(): JSX.Element | null {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

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
  }, [slug]);

  if (!slug) {
    return <NotFoundScreen />;
  }
  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center text-muted-foreground">
        {copy.loading}
      </main>
    );
  }
  if (state.status === "error") {
    if (state.error.status === 404) {
      return <NotFoundScreen />;
    }
    return (
      <main className="flex min-h-screen items-center justify-center text-destructive">
        {copy.genericError}
      </main>
    );
  }

  const { signatories } = state.bundle;
  if (!signatories) {
    return (
      <main className="mx-auto max-w-[640px] px-5 py-5 text-sm text-muted-foreground">
        {copy.signatories.hidden}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[640px] px-5 pb-8">
      {/*
        `specs/screens/public-and-embed.md` § Signatories page/fragment:
        "Minimal chrome does not mean unstyled: it carries the design's
        card, type and signatory chips ... so it reads as part of the same
        statement whether it is opened on its own or framed on the
        organization's site." It is the participant screen's own card
        (#60) — the two lists are the same list, and one of them had been
        a bare `<ul>` of plain text.
      */}
      <Signatories signatories={signatories} />
      {signatories.updated_at ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {copy.signatoriesPage.updatedAt(formatAbsolute(signatories.updated_at))}
        </p>
      ) : null}
    </main>
  );
}
