import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router";

import { ApiError, getDocument } from "./api.ts";
import { copy } from "./copy.ts";
import { DocumentContext, type DocumentContextValue } from "./DocumentContext.tsx";
import { useAdminSession } from "./SessionContext.tsx";
import { type DocumentDetail } from "./types.ts";
import { useDocumentTitle } from "../lib/useDocumentTitle.ts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; document: DocumentDetail };

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2.5 text-sm font-semibold ${
    isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground"
  }`;

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

  const { session } = useAdminSession();
  useDocumentTitle(
    state.status === "ready" ? state.document.title : undefined,
    session.instance_name || copy.instanceName,
  );

  const contextValue: DocumentContextValue | undefined = useMemo(
    () => (state.status === "ready" ? { document: state.document, refetch: load } : undefined),
    [state, load],
  );

  if (state.status === "loading") {
    return <main className="mx-auto max-w-[1120px] p-5 text-muted-foreground">{copy.loading}</main>;
  }
  if (state.status === "error" || !contextValue) {
    return (
      <main className="mx-auto max-w-[1120px] p-5 text-destructive" role="alert">
        {state.status === "error" ? state.message : copy.genericError}
      </main>
    );
  }

  return (
    <DocumentContext.Provider value={contextValue}>
      <div className="border-b border-border">
        <div className="mx-auto max-w-[1120px] px-5">
          <h1 className="pt-5 text-xl font-bold tracking-tight text-foreground">
            {contextValue.document.title}
          </h1>
          <nav className="-mx-5 mt-3 flex gap-1 overflow-x-auto px-5">
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
      </div>
      <Outlet />
    </DocumentContext.Provider>
  );
}
