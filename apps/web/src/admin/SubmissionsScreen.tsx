import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError, getSubmissions } from "./api.ts";
import { copy } from "./copy.ts";
import { useAdminDocument } from "./DocumentContext.tsx";
import { type SubmissionView } from "./types.ts";

interface AnchorLike {
  heading_path?: string[];
  quote?: string;
}

function submissionAnchor(id: string): string {
  return `submission-${id}`;
}

function BySubmissionView({ submissions }: { submissions: SubmissionView[] }): JSX.Element {
  const submitted = submissions.filter((s) => s.state === "submitted");
  const drafts = submissions.filter((s) => s.state === "draft");

  function renderGroup(items: SubmissionView[]): JSX.Element {
    return (
      <ul className="mt-2 flex flex-col gap-4">
        {items.map((submission) => (
          <li
            key={submission.id}
            id={submissionAnchor(submission.id)}
            className="rounded border border-border p-3 text-sm"
          >
            <p className="font-medium">
              {submission.author} · v{submission.version} ·{" "}
              {submission.state === "draft" ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {copy.submissions.unsubmittedBadge}
                </span>
              ) : (
                (submission.judgement ?? "comment")
              )}
            </p>
            <ul className="mt-2 flex flex-col gap-2 pl-3">
              {submission.comments.map((comment) => {
                const anchor = comment.anchor as AnchorLike | null;
                return (
                  <li key={comment.id} className="border-l-2 border-border pl-2">
                    {anchor?.heading_path && anchor.heading_path.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {anchor.heading_path.join(" > ")}
                      </p>
                    ) : null}
                    {anchor?.quote ? (
                      <p className="text-xs italic text-muted-foreground">“{anchor.quote}”</p>
                    ) : null}
                    <p>{comment.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {comment.disposition ? comment.disposition.outcome : copy.submissions.pending}
                    </p>
                  </li>
                );
              })}
              {submission.comments.length === 0 ? (
                <li className="text-muted-foreground">No comments.</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <h3 className="mt-4 text-sm font-semibold uppercase text-muted-foreground">
        {copy.submissions.submittedGroup}
      </h3>
      {submitted.length > 0 ? (
        renderGroup(submitted)
      ) : (
        <p className="text-muted-foreground">{copy.submissions.empty}</p>
      )}

      {drafts.length > 0 ? (
        <>
          <h3 className="mt-6 text-sm font-semibold uppercase text-muted-foreground">
            {copy.submissions.unsubmittedGroup}
          </h3>
          {renderGroup(drafts)}
        </>
      ) : null}
    </div>
  );
}

function ByPassageView({ submissions }: { submissions: SubmissionView[] }): JSX.Element {
  const groups = new Map<
    string,
    { submission: SubmissionView; comment: SubmissionView["comments"][number] }[]
  >();
  for (const submission of submissions) {
    for (const comment of submission.comments) {
      const anchor = comment.anchor as AnchorLike | null;
      const key =
        anchor?.heading_path && anchor.heading_path.length > 0
          ? anchor.heading_path.join(" > ")
          : "(no heading)";
      const list = groups.get(key) ?? [];
      list.push({ submission, comment });
      groups.set(key, list);
    }
  }

  if (groups.size === 0) {
    return <p className="mt-2 text-muted-foreground">{copy.submissions.empty}</p>;
  }

  return (
    <div className="mt-2 flex flex-col gap-4">
      {[...groups.entries()].map(([heading, entries]) => (
        <div key={heading}>
          <h3 className="text-sm font-semibold">{heading}</h3>
          <ul className="mt-1 flex flex-col gap-2 pl-3 text-sm">
            {entries.map(({ submission, comment }) => (
              <li key={comment.id} className="border-l-2 border-border pl-2">
                <p>{comment.body}</p>
                <a href={`#${submissionAnchor(submission.id)}`} className="text-xs underline">
                  {copy.submissions.previewLink} ({submission.author}
                  {submission.state === "draft" ? `, ${copy.submissions.unsubmittedBadge}` : ""})
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** `/admin/d/:slug/submissions` — `specs/screens/admin-dashboard.md` § "Submissions". */
export function SubmissionsScreen(): JSX.Element {
  const { document } = useAdminDocument();
  const [searchParams, setSearchParams] = useSearchParams();
  const [submissions, setSubmissions] = useState<SubmissionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const view = searchParams.get("view") === "passage" ? "passage" : "whole";
  const disposition = searchParams.get("disposition") ?? "";
  const version = searchParams.get("version") ?? "";
  const judgement = searchParams.get("judgement") ?? "";
  const person = searchParams.get("person") ?? "";

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    // `state=all` so drafts are available for the "Unsubmitted" group
    // (`specs/api/admin.md`: default is `submitted`; drafts only on request).
    getSubmissions(document.slug, {
      state: "all",
      disposition: disposition || undefined,
      version: version || undefined,
      person: person || undefined,
    })
      .then((rows) => {
        setSubmissions(judgement ? rows.filter((r) => r.judgement === judgement) : rows);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : copy.genericError));
  }, [document.slug, disposition, version, judgement, person]);

  return (
    <main className="p-4">
      <h2 className="font-semibold">{copy.submissions.heading}</h2>

      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          onClick={() => updateParam("view", "")}
          aria-pressed={view === "whole"}
          className={`rounded border border-border px-2 py-1 ${view === "whole" ? "font-semibold" : ""}`}
        >
          {copy.submissions.whole}
        </button>
        <button
          type="button"
          onClick={() => updateParam("view", "passage")}
          aria-pressed={view === "passage"}
          className={`rounded border border-border px-2 py-1 ${view === "passage" ? "font-semibold" : ""}`}
        >
          {copy.submissions.byPassage}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <select
          value={disposition}
          onChange={(e) => updateParam("disposition", e.target.value)}
          className="rounded border border-border px-2 py-1"
          aria-label={copy.submissions.filters.disposition}
        >
          <option value="">{copy.submissions.filters.disposition}</option>
          <option value="pending">pending</option>
          <option value="answered">answered</option>
          <option value="unanswered">unanswered</option>
        </select>
        <input
          value={version}
          onChange={(e) => updateParam("version", e.target.value)}
          placeholder={copy.submissions.filters.version}
          className="w-24 rounded border border-border px-2 py-1"
        />
        <input
          value={judgement}
          onChange={(e) => updateParam("judgement", e.target.value)}
          placeholder={copy.submissions.filters.judgement}
          className="w-32 rounded border border-border px-2 py-1"
        />
        <input
          value={person}
          onChange={(e) => updateParam("person", e.target.value)}
          placeholder={copy.submissions.filters.person}
          className="w-32 rounded border border-border px-2 py-1"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}

      {submissions ? (
        view === "whole" ? (
          <BySubmissionView submissions={submissions} />
        ) : (
          <ByPassageView submissions={submissions.filter((s) => s.state === "submitted")} />
        )
      ) : (
        <p className="mt-4 text-muted-foreground">{copy.loading}</p>
      )}
    </main>
  );
}
