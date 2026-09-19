import { useState } from "react";

import { copy } from "../copy.ts";
import { type TrayComment } from "./useDraftTray.ts";

function headingPathText(anchor: TrayComment["anchor"]): string | null {
  if (!anchor || anchor.heading_path.length === 0) {
    return null;
  }
  return anchor.heading_path.join(" › ");
}

/**
 * One inline (or general) comment row in the review tray —
 * `specs/screens/comment-mode.md` § Review tray: "the quoted passage
 * (truncated to two lines, expandable), the heading it sits under, the
 * body (editable in place), and delete", plus the per-item state badge
 * (`specs/behaviors/review-and-judgement.md`).
 */
export function TrayItem({
  comment,
  focused,
  onEdit,
  onCommit,
  onDelete,
}: {
  comment: TrayComment;
  focused: boolean;
  onEdit: (body: string) => void;
  onCommit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const quote = comment.anchor?.quote;
  const heading = headingPathText(comment.anchor);

  return (
    <li
      data-comment-item={comment.id}
      className={`flex flex-col gap-1.5 rounded border p-2.5 text-sm transition-colors ${
        focused ? "border-foreground bg-muted" : "border-border"
      }`}
    >
      {quote ? (
        <div className="text-xs text-muted-foreground">
          {heading ? <p className="font-medium">{heading}</p> : null}
          <blockquote
            className={`border-l-2 border-border pl-2 italic ${expanded ? "" : "line-clamp-2"}`}
          >
            "{quote}"
          </blockquote>
          {quote.length > 80 ? (
            <button
              type="button"
              className="underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? copy.commentMode.quoteCollapse : copy.commentMode.quoteExpand}
            </button>
          ) : null}
          {comment.unplaced ? (
            <p className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {comment.anchor ? copy.commentMode.unplacedBadge(comment.anchor.version) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <textarea
        value={comment.body}
        onChange={(event) => onEdit(event.target.value)}
        onBlur={onCommit}
        rows={2}
        className="w-full rounded border border-border p-2 text-sm"
      />

      {comment.conflictNote ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{comment.conflictNote}</p>
      ) : null}

      <div className="flex items-center justify-between text-xs">
        <span
          className={
            comment.status === "saved"
              ? "text-muted-foreground"
              : comment.status === "saving"
                ? "text-muted-foreground"
                : "text-amber-700 dark:text-amber-300"
          }
          role={comment.status === "retrying" || comment.status === "error" ? "status" : undefined}
        >
          {copy.commentMode.itemState[comment.status]}
        </span>
        <button type="button" className="underline" onClick={onDelete}>
          {copy.commentMode.deleteComment}
        </button>
      </div>
    </li>
  );
}
