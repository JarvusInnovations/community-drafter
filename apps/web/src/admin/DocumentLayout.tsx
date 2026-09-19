import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router";

import { ApiError, getDocument } from "./api.ts";
import { copy } from "./copy.ts";
import { DocumentContext, type DocumentContextValue } from "./DocumentContext.tsx";
import { type DocumentDetail } from "./types.ts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; document: DocumentDetail };

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm ${isActive ? "border-foreground font-semibold" : "border-transparent text-muted-foreground"}`;

/** Layout for the whole `/admin/d/:slug/*` family: fetches the document once, shares it via context. */
export function DocumentLayout(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!slug) {
      return;
    }
    try {
      const document = await getDocument(slug);
      setState({ status: "ready", document });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof ApiError ? err.message : copy.genericError,
      });
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const contextValue: DocumentContextValue | undefined = useMemo(
    () => (state.status === "ready" ? { document: state.document, refetch: load } : undefined),
    [state, load],
  );

  if (state.status === "loading") {
    return <main className="p-6 text-muted-foreground">{copy.loading}</main>;
  }
  if (state.status === "error" || !contextValue) {
    return (
      <main className="p-6 text-destructive" role="alert">
        {state.status === "error" ? state.message : copy.genericError}
      </main>
    );
  }

  return (
    <DocumentContext.Provider value={contextValue}>
      <div className="border-b border-border px-4">
        <h1 className="pt-4 text-xl font-semibold">{contextValue.document.title}</h1>
        <nav className="mt-2 flex gap-1">
          <NavLink to={`/admin/d/${slug}`} className={tabClass} end>
            Dashboard
          </NavLink>
          <NavLink to={`/admin/d/${slug}/people`} className={tabClass}>
            People
          </NavLink>
          <NavLink to={`/admin/d/${slug}/submissions`} className={tabClass}>
            Submissions
          </NavLink>
          <NavLink to={`/admin/d/${slug}/versions`} className={tabClass}>
            Versions
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </DocumentContext.Provider>
  );
}
