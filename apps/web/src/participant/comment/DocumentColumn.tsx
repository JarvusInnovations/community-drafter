import { type Anchor, type SelectionInfo, computeAnchor } from "@community-drafter/shared/browser";
import { useEffect, useRef, useState } from "react";

import { copy } from "../copy.ts";
import { blocksFromDom } from "./blocks.ts";
import { type HighlightTarget, applyHighlights } from "./highlights.ts";
import { wireSelectionCapture } from "./selection.ts";

interface PendingSelection {
  info: SelectionInfo;
  rect: DOMRect;
}

export function DocumentColumn({
  html,
  version,
  highlightTargets,
  onAddComment,
  onHighlightClick,
}: {
  html: string;
  version: number;
  highlightTargets: HighlightTarget[];
  onAddComment: (anchor: Anchor, body: string) => void;
  onHighlightClick: (id: string) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBody, setComposerBody] = useState("");
  // Clicking "Comment" collapses the browser's own text selection (any
  // click outside it does), which fires `selectionchange` — read here so
  // the capture callback below (set up once per `html`, not per render)
  // doesn't clear `pending` out from under an already-open composer.
  const composerOpenRef = useRef(composerOpen);
  composerOpenRef.current = composerOpen;

  // `specs/screens/comment-mode.md`'s risk note: keep the body in a stable
  // ref so React's re-renders never tear it down between selection and
  // capture (`DocumentBody.tsx` does the same for the read-only view).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.innerHTML = html;
  }, [html]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    applyHighlights(container, highlightTargets, version, onHighlightClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlightTargets, version]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    return wireSelectionCapture(container, (info, range) => {
      if (composerOpenRef.current) {
        return;
      }
      if (!info || !range) {
        setPending(null);
        return;
      }
      setPending({ info, rect: range.getBoundingClientRect() });
    });
  }, [html]);

  function handleAdd(): void {
    const container = containerRef.current;
    if (!container || !pending || composerBody.trim().length === 0) {
      return;
    }

    const blocks = blocksFromDom(container);
    const anchor = computeAnchor({
      blocks,
      blockId: pending.info.blockId,
      start: pending.info.start,
      length: pending.info.length,
      version,
      commit: "",
    });
    if (pending.info.spansBlocks) {
      anchor.spans_blocks = true;
    }

    onAddComment(anchor, composerBody.trim());
    setComposerBody("");
    setComposerOpen(false);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div className="relative">
      <div ref={containerRef} className="doc-body mt-4 px-4" data-testid="comment-document-body" />

      {pending && !composerOpen ? (
        <button
          type="button"
          className="fixed z-20 rounded bg-foreground px-3 py-1.5 text-sm font-semibold text-background shadow-lg"
          style={{ top: pending.rect.bottom + 8, left: pending.rect.left }}
          onClick={() => setComposerOpen(true)}
        >
          {copy.commentMode.commentButton}
        </button>
      ) : null}

      {pending && composerOpen ? (
        <div
          className="fixed z-20 flex w-72 flex-col gap-2 rounded border border-border bg-background p-3 shadow-lg"
          style={{ top: pending.rect.bottom + 8, left: pending.rect.left }}
        >
          <textarea
            autoFocus
            value={composerBody}
            onChange={(event) => setComposerBody(event.target.value)}
            onBlur={() => {
              if (composerBody.trim().length > 0) {
                handleAdd();
              }
            }}
            rows={3}
            className="w-full rounded border border-border p-2 text-sm"
          />
          <div className="flex justify-end gap-2 text-sm">
            <button
              type="button"
              className="rounded border border-border px-2 py-1"
              onClick={() => {
                setComposerOpen(false);
                setPending(null);
                setComposerBody("");
              }}
            >
              {copy.commentMode.composerCancel}
            </button>
            <button
              type="button"
              className="rounded bg-foreground px-2 py-1 text-background"
              onClick={handleAdd}
            >
              {copy.commentMode.composerAdd}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
