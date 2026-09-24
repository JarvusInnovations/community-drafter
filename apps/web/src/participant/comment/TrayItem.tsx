import { useLayoutEffect, useRef, useState } from "react";

import { AutoTextarea } from "../components/AutoTextarea.tsx";
import { copy } from "../copy.ts";
import { type CommentStatus, type TrayComment } from "./useDraftTray.ts";

/**
 * `specs/screens/comment-mode.md` § Design "Review tray": "a state badge
 * (Saved in green soft, Saving in muted, Not saved in amber soft, Restored
 * in blue soft)." `retrying`/`error` both render the same "Not saved,
 * retrying" copy (`copy.commentMode.itemState`), so both take the amber
 * treatment.
 */
const BADGE_CLASS: Record<CommentStatus, string> = {
  saved: "bg-ok-soft text-ok",
  saving: "bg-muted text-muted-foreground",
  retrying: "bg-amber-soft text-amber",
  error: "bg-amber-soft text-amber",
  restored: "bg-primary-soft text-primary-deep",
};

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
  const [clamped, setClamped] = useState(false);
  const quoteRef = useRef<HTMLQuoteElement>(null);
  const quote = comment.anchor?.quote;
  const heading = headingPathText(comment.anchor);

  // "Show more" used to appear for any quote over 80 characters, whether or
  // not the two-line clamp actually hid anything — so on a short quote it
  // toggled a class that changed nothing (issue #73). Ask the layout.
  useLayoutEffect(() => {
    const element = quoteRef.current;
    if (!element || expanded || !quote) {
      return;
    }
    setClamped(element.scrollHeight > element.clientHeight + 1);
  }, [quote, expanded]);

  return (
    <li
      data-comment-item={comment.id}
      className={`flex flex-col gap-2 rounded-xl border p-3 text-sm transition-colors ${
        focused ? "border-primary bg-primary-soft" : "border-border bg-card"
      }`}
    >
      {quote ? (
        <div className="text-xs text-muted-foreground">
          {heading ? <p className="font-semibold uppercase tracking-wider">{heading}</p> : null}
          <blockquote
            ref={quoteRef}
            className={`mt-1 border-l-2 border-border pl-2 italic ${expanded ? "" : "line-clamp-2"}`}
          >
            "{quote}"
          </blockquote>
          {clamped || expanded ? (
            <button
              type="button"
              className="mt-0.5 font-medium text-primary"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? copy.commentMode.quoteCollapse : copy.commentMode.quoteExpand}
            </button>
          ) : null}
          {comment.unplaced ? (
            <p className="mt-1.5 inline-block rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber">
              {comment.anchor ? copy.commentMode.unplacedBadge(comment.anchor.version) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <AutoTextarea
        value={comment.body}
        onChange={(event) => onEdit(event.target.value)}
        onBlur={onCommit}
        rows={2}
        className="w-full resize-none rounded-xl border border-border bg-card p-2.5 text-sm text-foreground"
      />

      {comment.conflictNote ? <p className="text-xs text-amber">{comment.conflictNote}</p> : null}

      <div className="flex items-center justify-between">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${BADGE_CLASS[comment.status]}`}
          role={comment.status === "retrying" || comment.status === "error" ? "status" : undefined}
        >
          {copy.commentMode.itemState[comment.status]}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground"
          onClick={onDelete}
        >
          {copy.commentMode.deleteComment}
        </button>
      </div>
    </li>
  );
}
