import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError, getSubmissions } from "./api.ts";
import { Card } from "./components/Card.tsx";
import { Pill, type PillTone } from "./components/Pill.tsx";
import { copy } from "./copy.ts";
import { useAdminDocument } from "./DocumentContext.tsx";
import { chipClass, inputClass, quietLinkClass, selectClass } from "./styles.ts";
import { type SubmissionView } from "./types.ts";

interface AnchorLike {
  heading_path?: string[];
  quote?: string;
}

function submissionAnchor(id: string): string {
  return `submission-${id}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * `specs/screens/admin-dashboard.md` § Design "Submissions page": disposition
 * pills — "pending muted, accepted green, partial blue, declined amber,
 * noted muted."
 */
function dispositionPill(outcome: string | undefined): { tone: PillTone; label: string } {
  switch (outcome) {
    case "accepted":
      return { tone: "ok", label: "accepted" };
    case "partial":
      return { tone: "primary", label: "partial" };
    case "declined":
      return { tone: "amber", label: "declined" };
    case "noted":
      return { tone: "muted", label: "noted" };
    default:
      return { tone: "muted", label: copy.submissions.pending };
  }
}

function SubmissionCard({ submission }: { submission: SubmissionView }): JSX.Element {
  return (
    <li
      id={submissionAnchor(submission.id)}
      className="rounded-2xl border border-border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 flex-none place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-deep"
        >
          {initials(submission.author)}
        </span>
        <p className="font-semibold text-foreground">{submission.author}</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
          v{submission.version}
        </span>
        {submission.state === "draft" ? (
          <Pill tone="amber">{copy.submissions.unsubmittedBadge}</Pill>
        ) : (
          <Pill tone="ok">{submission.judgement ?? "comment"}</Pill>
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3 pl-1">
        {submission.comments.map((comment) => {
          const anchor = comment.anchor as AnchorLike | null;
          const pill = dispositionPill(comment.disposition?.outcome);
          return (
            <li key={comment.id} className="rounded-xl border border-border px-3 py-2.5">
              {anchor?.heading_path && anchor.heading_path.length > 0 ? (
                <p className="text-xs text-muted-foreground">{anchor.heading_path.join(" > ")}</p>
              ) : null}
              {anchor?.quote ? (
                <p className="text-xs italic text-muted-foreground">“{anchor.quote}”</p>
              ) : null}
              <p className="mt-1 text-foreground">{comment.body}</p>
              <div className="mt-1.5">
                <Pill tone={pill.tone}>{pill.label}</Pill>
              </div>
            </li>
          );
        })}
        {submission.comments.length === 0 ? (
          <li className="text-muted-foreground">No comments.</li>
        ) : null}
      </ul>
    </li>
  );
}

function SubmissionGroup({ items }: { items: SubmissionView[] }): JSX.Element {
  return (
    <ul className="mt-2 flex flex-col gap-4">
      {items.map((submission) => (
        <SubmissionCard key={submission.id} submission={submission} />
      ))}
    </ul>
  );
}

function BySubmissionView({ submissions }: { submissions: SubmissionView[] }): JSX.Element {
  const submitted = submissions.filter((s) => s.state === "submitted");
  const drafts = submissions.filter((s) => s.state === "draft");

  return (
    <div>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {copy.submissions.submittedGroup}
      </h3>
      {submitted.length > 0 ? (
        <SubmissionGroup items={submitted} />
      ) : (
        <p className="mt-2 text-muted-foreground">{copy.submissions.empty}</p>
      )}

      {drafts.length > 0 ? (
        <>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {copy.submissions.unsubmittedGroup}
          </h3>
          <SubmissionGroup items={drafts} />
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
        <Card key={heading}>
          <h3 className="text-sm font-bold text-foreground">{heading}</h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {entries.map(({ submission, comment }) => (
              <li key={comment.id} className="rounded-xl border border-border px-3 py-2.5">
                <p className="text-foreground">{comment.body}</p>
                <a
                  href={`#${submissionAnchor(submission.id)}`}
                  className={`mt-1 inline-block ${quietLinkClass}`}
                >
                  {copy.submissions.previewLink} ({submission.author}
                  {submission.state === "draft" ? `, ${copy.submissions.unsubmittedBadge}` : ""})
                </a>
              </li>
            ))}
          </ul>
        </Card>
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

  const activeFilters = [
    disposition ? { key: "disposition", label: `Disposition: ${disposition}` } : null,
    version ? { key: "version", label: `Version: ${version}` } : null,
    judgement ? { key: "judgement", label: `Judgement: ${judgement}` } : null,
    person ? { key: "person", label: `Person: ${person}` } : null,
  ].filter((f): f is { key: string; label: string } => f !== null);

  return (
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <h2 className="text-lg font-bold tracking-tight text-foreground">
        {copy.submissions.heading}
      </h2>

      <div className="mt-3 inline-flex rounded-xl bg-muted p-1 text-sm">
        <button
          type="button"
          onClick={() => updateParam("view", "")}
          aria-pressed={view === "whole"}
          className={`rounded-lg px-3 py-1.5 font-semibold ${
            view === "whole" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          {copy.submissions.whole}
        </button>
        <button
          type="button"
          onClick={() => updateParam("view", "passage")}
          aria-pressed={view === "passage"}
          className={`rounded-lg px-3 py-1.5 font-semibold ${
            view === "passage" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          {copy.submissions.byPassage}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <select
          value={disposition}
          onChange={(e) => updateParam("disposition", e.target.value)}
          className={selectClass}
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
          className={`${inputClass} w-24`}
        />
        <input
          value={judgement}
          onChange={(e) => updateParam("judgement", e.target.value)}
          placeholder={copy.submissions.filters.judgement}
          className={`${inputClass} w-32`}
        />
        <input
          value={person}
          onChange={(e) => updateParam("person", e.target.value)}
          placeholder={copy.submissions.filters.person}
          className={`${inputClass} w-32`}
        />
      </div>

      {activeFilters.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => updateParam(filter.key, "")}
              className={chipClass}
            >
              {filter.label}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-destructive">
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
