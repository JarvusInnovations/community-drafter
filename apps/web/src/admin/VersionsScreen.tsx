import { useEffect, useState } from "react";

import { ApiError, getVersionDetail } from "./api.ts";
import { Card } from "./components/Card.tsx";
import { Pill } from "./components/Pill.tsx";
import { copy } from "./copy.ts";
import { useAdminDocument } from "./DocumentContext.tsx";
import { quietButtonClass, quietLinkClass } from "./styles.ts";
import { type VersionDetail } from "./types.ts";
import { formatAbsolute } from "../participant/format.ts";

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
  const currentVersion = document.versions.reduce((max, v) => Math.max(max, v.number), 0);
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
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{copy.versions.heading}</h2>
      {error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}

      <Card className="mt-3 p-0">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="w-10">#</span>
          <span className="flex-1">Summary</span>
          <span className="hidden sm:block">Published</span>
        </div>
        <ul className="flex flex-col">
          {document.versions.map((v) => (
            <li key={v.number} className="border-b border-border px-4 py-3 text-sm last:border-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  className={`${quietLinkClass} text-left`}
                  onClick={() => void toggle(v.number)}
                >
                  v{v.number} — {v.summary}
                </button>
                {/*
                  `specs/screens/admin-dashboard.md` § Versions: the current
                  version is marked as such — the list read as four
                  equivalent rows with no way to tell which one participants
                  are looking at (#60).
                */}
                {v.number === currentVersion ? (
                  <Pill tone="ok">{copy.versions.current}</Pill>
                ) : null}
                <span className="text-muted-foreground">
                  {formatAbsolute(v.published_at)} · {copy.versions.dispositions(v.dispositions)}
                  {v.final ? " · final" : ""}
                </span>
              </div>
              {open === v.number ? (
                <div className="mt-2 rounded-xl bg-muted p-3">
                  {details[v.number] ? (
                    <>
                      <p className="text-muted-foreground">
                        Published by: {details[v.number]?.published_by ?? "—"}
                      </p>
                      {details[v.number]?.notes ? (
                        <p className="mt-1 text-foreground">Notes: {details[v.number]?.notes}</p>
                      ) : null}
                      {/*
                        `specs/screens/admin-dashboard.md` § Versions: "A
                        version's text is readable in place — the console is
                        where the team reads what it published, and a
                        download is not reading." (#60)
                      */}
                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-3 text-xs text-foreground">
                        {details[v.number]?.body ?? ""}
                      </pre>
                      <button
                        type="button"
                        className={`mt-2 ${quietButtonClass}`}
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
      </Card>
    </main>
  );
}
