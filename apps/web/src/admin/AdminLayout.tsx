import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router";

import { ApiError, getSession, logout } from "./api.ts";
import { copy } from "./copy.ts";
import { SessionContext, type SessionContextValue } from "./SessionContext.tsx";
import { SignInScreen } from "./SignInScreen.tsx";

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
    return <SignInScreen />;
  }

  return (
    <SessionContext.Provider value={contextValue}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <NavLink to="/admin" className="font-semibold" end>
            {copy.nav.documents}
          </NavLink>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{contextValue.session.email}</span>
            <button
              type="button"
              className="underline"
              onClick={() => {
                void logout().then(() => {
                  window.location.href = "/admin";
                });
              }}
            >
              {copy.nav.signOut}
            </button>
          </div>
        </header>
        <Outlet />
      </div>
    </SessionContext.Provider>
  );
}
