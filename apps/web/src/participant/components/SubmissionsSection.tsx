import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";
import { type SubmissionView } from "../types.ts";

/**
 * `specs/screens/document.md` § Display Rules 6: "if the person has
 * submitted, a collapsed section listing each submission whole (version,
 * date, judgement, its comments with disposition badges)." Only submitted
 * submissions are listed here — the in-progress draft is surfaced
 * separately by the status card's "unsent comments" line.
 */
export function SubmissionsSection({
  submissions,
}: {
  submissions: SubmissionView[];
}): JSX.Element | null {
  const submitted = submissions.filter((submission) => submission.state === "submitted");
  if (submitted.length === 0) {
    return null;
  }

  return (
    <details className="mx-4 mt-4 rounded border border-border p-3">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        {copy.submissions.heading}
      </summary>
      <ul className="mt-2 flex flex-col gap-3">
        {submitted.map((submission) => (
          <li key={submission.id} className="text-sm">
            <p className="font-medium text-foreground">
              {copy.submissions.versionLabel(submission.version)} ·{" "}
              {formatAbsolute(submission.submitted_at)} ·{" "}
              {copy.submissions.judgementLabel(submission.judgement)}
            </p>
            {submission.comments.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1 pl-3">
                {submission.comments.map((comment) => (
                  <li key={comment.id} className="text-muted-foreground">
                    <span>{comment.body}</span>
                    {comment.disposition ? (
                      <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs">
                        {copy.submissions.dispositionLabel(comment.disposition.outcome)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
