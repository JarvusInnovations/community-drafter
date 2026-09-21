import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ApiError, listDocuments } from "./api.ts";
import { TableScroller } from "./components/TableScroller.tsx";
import { copy } from "./copy.ts";
import { useAdminSession } from "./SessionContext.tsx";
import { type DocumentSummary } from "./types.ts";

function formatDeadline(doc: DocumentSummary): string {
  const next =
    doc.phase === "commenting"
      ? doc.comments_close_at
      : doc.phase === "signing"
        ? doc.signing_closes_at
        : undefined;
  return next ? new Date(next).toLocaleString() : "—";
}

/** `/admin` — the document list, `specs/screens/admin-dashboard.md` § "Document list". */
export function DocumentListScreen(): JSX.Element {
  const { session } = useAdminSession();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((result) => {
        if (!cancelled) {
          setDocs(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : copy.genericError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        {copy.documentList.heading}
      </h1>
      {session?.superadmin ? (
        <p className="mt-1 text-sm text-muted-foreground">{copy.documentList.superadminNote}</p>
      ) : null}

      <p className="mt-3 rounded-xl border-l-[3px] border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
        {copy.documentList.newDocumentHint}{" "}
        <code className="rounded bg-card px-1.5 py-0.5">
          {copy.documentList.newDocumentCommand}
        </code>
      </p>

      {error ? (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      ) : null}

      {docs === null && !error ? (
        <p className="mt-4 text-muted-foreground">{copy.loading}</p>
      ) : null}

      {docs && docs.length === 0 ? (
        <p className="mt-4 text-muted-foreground">{copy.documentList.empty}</p>
      ) : null}

      {docs && docs.length > 0 ? (
        <TableScroller className="mt-4">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">State / phase</th>
                <th className="px-4 py-3">Next deadline</th>
                <th className="px-4 py-3">Invited</th>
                <th className="px-4 py-3">Opened</th>
                <th className="px-4 py-3">Signed</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.slug} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link to={`/admin/d/${doc.slug}`} className="font-semibold text-primary">
                      {doc.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {doc.state} / {doc.phase}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDeadline(doc)}</td>
                  <td className="px-4 py-3 text-foreground">{doc.counts.participations}</td>
                  <td className="px-4 py-3 text-foreground">
                    {doc.counts.submissions.submitted + doc.counts.submissions.draft}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {doc.counts.signatures.organizations + doc.counts.signatures.individuals}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      ) : null}
    </main>
  );
}
