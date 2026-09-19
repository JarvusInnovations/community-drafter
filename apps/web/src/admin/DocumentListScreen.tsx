import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ApiError, listDocuments } from "./api.ts";
import { copy } from "./copy.ts";
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
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold">{copy.documentList.heading}</h1>

      <p className="mt-2 rounded border border-border bg-muted p-3 text-sm text-muted-foreground">
        {copy.documentList.newDocumentHint}{" "}
        <code className="rounded bg-background px-1.5 py-0.5">
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
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2">Title</th>
              <th className="py-2">State / phase</th>
              <th className="py-2">Next deadline</th>
              <th className="py-2">Invited</th>
              <th className="py-2">Opened</th>
              <th className="py-2">Signed</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.slug} className="border-b border-border">
                <td className="py-2">
                  <Link to={`/admin/d/${doc.slug}`} className="font-medium underline">
                    {doc.title}
                  </Link>
                </td>
                <td className="py-2">
                  {doc.state} / {doc.phase}
                </td>
                <td className="py-2">{formatDeadline(doc)}</td>
                <td className="py-2">{doc.counts.participations}</td>
                <td className="py-2">
                  {doc.counts.submissions.submitted + doc.counts.submissions.draft}
                </td>
                <td className="py-2">
                  {doc.counts.signatures.organizations + doc.counts.signatures.individuals}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
