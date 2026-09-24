import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useParams } from "react-router";

import { ApiError, getBundle } from "./api.ts";
import { BundleContext, type BundleContextValue } from "./BundleContext.tsx";
import { SiteBar } from "./components/SiteBar.tsx";
import { SiteTheme } from "./components/SiteTheme.tsx";
import { copy } from "./copy.ts";
import { NotFoundScreen } from "./NotFoundScreen.tsx";
import { type Bundle } from "./types.ts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; bundle: Bundle };

/**
 * The layout route for the whole `/i/:token/*` family. Fetches
 * `GET /i/:token/api/bundle` once per token and shares it with every nested
 * route through `BundleContext` (`plans/participant-sign-flow.md` §
 * Approach). A 404 (unknown/revoked/expired token) renders the generic
 * `NotFoundScreen` in place of the route tree — no cookies or local storage
 * are used anywhere in this tree (`specs/architecture.md`).
 */
export function ParticipantLayout(): JSX.Element | null {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const bundle = await getBundle(token);
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
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const readyBundle = state.status === "ready" ? state.bundle : undefined;
  const contextValue: BundleContextValue | undefined = useMemo(
    () => (token && readyBundle ? { token, bundle: readyBundle, refetch: load } : undefined),
    [token, readyBundle, load],
  );

  if (!token) {
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

  // `state.status === "ready"` here (the loading/error branches above both
  // returned), so `contextValue` is defined — the `useMemo` above just can't
  // express that narrowing itself since it runs before those returns.
  if (!contextValue) {
    return null;
  }

  return (
    <BundleContext.Provider value={contextValue}>
      <SiteTheme site={state.bundle.site}>
        <SiteBar site={state.bundle.site} document={state.bundle.document} />
        <Outlet />
      </SiteTheme>
    </BundleContext.Provider>
  );
}
