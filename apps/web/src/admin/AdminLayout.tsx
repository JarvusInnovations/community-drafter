import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";

import { ApiError, getSession, logout } from "./api.ts";
import { copy } from "./copy.ts";
import { SessionContext, type SessionContextValue } from "./SessionContext.tsx";

type LoadState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "ready"; session: SessionContextValue["session"] };

/**
 * The layout for the whole `/admin/*` family — resolves the admin session
 * once (`GET /auth/session`) and either renders the sign-in screen or the
 * nav + `Outlet` (`specs/screens/admin-dashboard.md` § Navigation).
 */
export function AdminLayout(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const location = useLocation();

  const load = useCallback(async () => {
    try {
      const session = await getSession();
      setState({ status: "ready", session });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setState({ status: "signed-out" });
        return;
      }
      setState({ status: "signed-out" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readySession = state.status === "ready" ? state.session : undefined;
  const contextValue: SessionContextValue | undefined = useMemo(
    () => (readySession ? { session: readySession, refetch: load } : undefined),
    [readySession, load],
  );

  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center text-muted-foreground">
        {copy.loading}
      </main>
    );
  }

  if (state.status === "signed-out" || !contextValue) {
    const returnPath = `${location.pathname}${location.search}`;
    return <Navigate to={`/admin/login?return=${encodeURIComponent(returnPath)}`} replace />;
  }

  return (
    <SessionContext.Provider value={contextValue}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          {/*
            `specs/screens/admin-dashboard.md` § Design "Phone width": the
            bar truncates rather than wrapping the instance name into a
            column, lets the operator's email truncate, and never pushes
            "Sign out" off the screen (#56). It wraps to two rows at phone
            width instead of overflowing; `min-w-0` on both groups is what
            lets `truncate` take effect inside a flex row.
          */}
          <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5">
            <NavLink
              to="/admin"
              end
              className="min-w-0 max-w-full truncate text-sm font-extrabold tracking-tight text-foreground"
            >
              {contextValue.session.site?.name || copy.siteName}
            </NavLink>
            <div className="flex min-w-0 max-w-full items-center gap-4 text-sm">
              <NavLink to="/admin/operators" className="flex-none font-medium text-primary">
                {copy.nav.operators}
              </NavLink>
              {/*
               * `specs/screens/admin-dashboard.md` § Design "Frame": "and
               * 'Sites' for a superadmin on the default host".
               */}
              {contextValue.session.superadmin &&
              (contextValue.session.site?.slug ?? "default") === "default" ? (
                <NavLink to="/admin/sites" className="flex-none font-medium text-primary">
                  {copy.nav.sites}
                </NavLink>
              ) : null}
              <span
                className="min-w-0 truncate text-muted-foreground"
                title={contextValue.session.email}
              >
                {contextValue.session.email}
              </span>
              <button
                type="button"
                className="flex-none font-medium text-primary"
                onClick={() => {
                  void logout().then(() => {
                    window.location.href = "/admin";
                  });
                }}
              >
                {copy.nav.signOut}
              </button>
            </div>
          </div>
        </header>
        <Outlet />
      </div>
    </SessionContext.Provider>
  );
}
