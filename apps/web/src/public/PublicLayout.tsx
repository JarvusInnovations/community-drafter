import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useParams } from "react-router";

import { ApiError, getPublicBundle } from "./api.ts";
import { copy } from "./copy.ts";
import { PublicBundleContext, type PublicBundleContextValue } from "./PublicBundleContext.tsx";
import { type PublicBundle } from "./types.ts";
import { NotFoundScreen } from "../participant/NotFoundScreen.tsx";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; bundle: PublicBundle };

/**
 * The layout route for `/d/:slug` and its non-embed children (`history`,
 * `history/compare`, `signatories`) — `embed` fetches its own bundle
 * independently since it deliberately renders no shared chrome at all
 * (`specs/screens/public-and-embed.md` § Display Rules "Embed"). Fetches
 * `GET /d/:slug/api/bundle` once and shares it through `PublicBundleContext`,
 * mirroring `../participant/ParticipantLayout.tsx`. A 404 — unknown slug,
 * `state = draft`, or `public_access = none` — renders the same generic
 * `NotFoundScreen` participant links use (`specs/screens/public-and-embed.md`:
 * "the same body").
 */
export function PublicLayout(): JSX.Element | null {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!slug) {
      return;
    }
    try {
      const bundle = await getPublicBundle(slug);
      setState({ status: "ready", bundle });
    } catch (err) {
      setState({
        status: "error",
        error:
          err instanceof ApiError
            ? err
            : new ApiError(500, "internal_error", copy.genericError, {}),
      });
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const readyBundle = state.status === "ready" ? state.bundle : undefined;
  const contextValue: PublicBundleContextValue | undefined = useMemo(
    () => (slug && readyBundle ? { slug, bundle: readyBundle, refetch: load } : undefined),
    [slug, readyBundle, load],
  );

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
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-foreground">{copy.genericError}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            void load();
          }}
          className="rounded border border-border px-3 py-1.5 text-sm"
        >
          Try again
        </button>
      </main>
    );
  }

  if (!contextValue) {
    return null;
  }

  return (
    <PublicBundleContext.Provider value={contextValue}>
      <Outlet />
    </PublicBundleContext.Provider>
  );
}
