import {
  type Anchor,
  placeAnchor,
  rangeFromAnchorPlacement,
} from "@community-drafter/shared/browser";

import { blocksFromDom } from "./blocks.ts";

/**
 * `specs/behaviors/inline-comments.md` § Re-anchoring on display: "displaying
 * a version tears down all highlights and rebuilds them, so live updates
 * never stack marks" — every call to `applyHighlights` starts by removing
 * any marks this module previously added.
 */
export interface HighlightTarget {
  id: string;
  anchor: Anchor;
  kind: "pending" | "submitted";
}

export interface PlacedHighlight {
  id: string;
  placed: boolean;
}

const HIGHLIGHT_ATTR = "data-comment-highlight";
const PENDING_CLASS = "drafter-highlight-pending";
const SUBMITTED_CLASS = "drafter-highlight-submitted";

export function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll(`mark[${HIGHLIGHT_ATTR}]`);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }
  container.normalize();
}

/**
 * Re-anchors and (re-)draws highlights for `targets` against the currently
 * rendered `container`, idempotently. Returns which ones placed, so the
 * caller can badge the rest "written on vN · passage changed" — an
 * unplaceable comment is never dropped from view
 * (`specs/principles.md#comments-never-orphan-silently`), it just gets no
 * highlight.
 */
export function applyHighlights(
  container: HTMLElement,
  targets: HighlightTarget[],
  displayedVersion: number,
  onClick: (id: string) => void,
): PlacedHighlight[] {
  clearHighlights(container);
  const blocks = blocksFromDom(container);
  const results: PlacedHighlight[] = [];

  for (const target of targets) {
    const placement = placeAnchor(target.anchor, blocks, displayedVersion);
    const range = placement ? rangeFromAnchorPlacement(container, placement) : null;
    if (!placement || !range) {
      results.push({ id: target.id, placed: false });
      continue;
    }

    try {
      const mark = document.createElement("mark");
      mark.setAttribute(HIGHLIGHT_ATTR, "true");
      mark.dataset.commentId = target.id;
      mark.className = target.kind === "pending" ? PENDING_CLASS : SUBMITTED_CLASS;
      mark.addEventListener("click", () => onClick(target.id));
      range.surroundContents(mark);
      results.push({ id: target.id, placed: true });
    } catch {
      // The range crosses an inline-formatting boundary `surroundContents`
      // can't wrap cleanly. Per the same principle: no highlight for this
      // one beats a broken document — it still renders in the tray with
      // its quote.
      results.push({ id: target.id, placed: false });
    }
  }

  return results;
}
