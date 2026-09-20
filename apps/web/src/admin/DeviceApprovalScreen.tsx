import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router";

import { ApiError, approveDevice, getSession, logout } from "./api.ts";
import { copy } from "./copy.ts";
import { type SessionInfo } from "./types.ts";

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "invalid" }
  | { status: "ready"; session: SessionInfo }
  | { status: "approved" };

function returnHere(code: string | null): string {
  return `/auth/device?code=${encodeURIComponent(code ?? "")}`;
}

/**
 * `/auth/device?code=` — `specs/screens/admin-dashboard.md` § "Device
 * approval" and `specs/api/auth.md` § Device-code flow. Approves a pending
 * CLI device code for the *signed-in* operator only; when nobody is signed
 * in, redirects to `/admin/login` with this page as the return path
 * (`specs/screens/admin-dashboard.md` § Navigation: "Any admin route
 * without a session redirects to `/admin/login` with a return path").
 */
export function DeviceApprovalScreen(): JSX.Element {
  const [params] = useSearchParams();
  const code = params.get("code");
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setState({ status: "invalid" });
      return;
    }
    let cancelled = false;
    getSession()
      .then((session) => {
        if (!cancelled) {
          setState({ status: "ready", session });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "signed-out" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.status === "signed-out") {
    return <Navigate to={`/admin/login?return=${encodeURIComponent(returnHere(code))}`} replace />;
  }

  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center text-muted-foreground">
        {copy.loading}
      </main>
    );
  }

  if (state.status === "invalid") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background p-6 text-center text-foreground">
        <p role="alert" className="text-destructive">
          {copy.device.invalidCode}
        </p>
      </main>
    );
  }

  async function handleApprove(): Promise<void> {
    if (!code) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await approveDevice(code);
      setState({ status: "approved" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.device.invalidCode);
    } finally {
      setBusy(false);
    }
  }

  async function handleNotMe(): Promise<void> {
    setBusy(true);
    try {
      await logout();
    } finally {
      window.location.href = `/admin/login?return=${encodeURIComponent(returnHere(code))}`;
    }
  }

  if (state.status === "approved") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background p-6 text-center text-foreground">
        <h1 className="text-xl font-semibold">{copy.device.heading}</h1>
        <p role="status" className="text-muted-foreground">
          {copy.device.approved}
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <h1 className="text-xl font-semibold">{copy.device.heading}</h1>
      <p className="text-muted-foreground">{copy.device.body(code ?? "")}</p>
      <p className="text-2xl font-mono tracking-widest">{code}</p>
      <p className="text-muted-foreground">{copy.device.signedInAs(state.session.email)}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={busy}
          className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {copy.device.approve}
        </button>
        <button
          type="button"
          onClick={() => void handleNotMe()}
          disabled={busy}
          className="rounded border border-border px-4 py-2 text-sm disabled:opacity-60"
        >
          {copy.device.notMe}
        </button>
      </div>
    </main>
  );
}
