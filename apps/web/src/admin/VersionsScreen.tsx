import { useEffect, useState } from "react";

import { ApiError, getVersionDetail } from "./api.ts";
import { copy } from "./copy.ts";
import { useAdminDocument } from "./DocumentContext.tsx";
import { type VersionDetail } from "./types.ts";

function downloadMarkdown(slug: string, n: number, body: string): void {
  const blob = new Blob([body], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `${slug}-v${n}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** `/admin/d/:slug/versions` — `specs/screens/admin-dashboard.md` § "Versions". */
export function VersionsScreen(): JSX.Element {
  const { document } = useAdminDocument();
  const [details, setDetails] = useState<Record<number, VersionDetail>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function toggle(n: number) {
    if (open === n) {
      setOpen(null);
      return;
    }
    setOpen(n);
    if (!details[n]) {
      try {
        const detail = await getVersionDetail(document.slug, n);
        setDetails((prev) => ({ ...prev, [n]: detail }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : copy.genericError);
      }
    }
  }

  useEffect(() => {
    setDetails({});
    setOpen(null);
    // Resets whenever the document changes; the effect body itself doesn't
    // read `document.slug` (only the setters below), which is exactly why
    // this needs to key off it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.slug]);

  return (
    <main className="p-4">
      <h2 className="font-semibold">{copy.versions.heading}</h2>
      {error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="mt-2 flex flex-col gap-2">
        {document.versions.map((v) => (
          <li key={v.number} className="rounded border border-border p-3 text-sm">
            <button
              type="button"
              className="font-medium underline"
              onClick={() => void toggle(v.number)}
            >
              v{v.number} — {v.summary}
            </button>{" "}
            <span className="text-muted-foreground">
              {new Date(v.published_at).toLocaleString()} ·{" "}
              {copy.versions.dispositions(v.dispositions)}
              {v.final ? " · final" : ""}
            </span>
            {open === v.number ? (
              <div className="mt-2 border-t border-border pt-2">
                {details[v.number] ? (
                  <>
                    <p className="text-muted-foreground">
                      Published by: {details[v.number]?.published_by ?? "—"}
                    </p>
                    {details[v.number]?.notes ? <p>Notes: {details[v.number]?.notes}</p> : null}
                    <button
                      type="button"
                      className="mt-2 rounded border border-border px-2 py-1"
                      onClick={() =>
                        downloadMarkdown(document.slug, v.number, details[v.number]?.body ?? "")
                      }
                    >
                      {copy.versions.downloadRaw}
                    </button>
                  </>
                ) : (
                  <p className="text-muted-foreground">{copy.loading}</p>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
