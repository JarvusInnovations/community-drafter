import { type SelectionInfo, anchorFromSelection } from "@signatories/shared/browser";

export interface SelectionCaptureOptions {
  /** Debounce for the `selectionchange` listener (ms). */
  debounceMs?: number;
}

export type SelectionCaptureCallback = (info: SelectionInfo | null, range: Range | null) => void;

/** Below this length, `specs/behaviors/inline-comments.md` says: show no "Comment" affordance. */
const MIN_SELECTION_LENGTH = 3;

/**
 * Wires selection capture on `container`: an immediate `mouseup` listener
 * plus a debounced `selectionchange` listener on the owning document — the
 * latter is what makes touch long-press work, since touch selection has no
 * `mouseup` event (`specs/behaviors/inline-comments.md` § Capture:
 * "Selection capture must work with mouse and with touch long-press (listen
 * to selection changes, debounced, not only mouse-up)"). Returns a cleanup
 * function that removes both listeners.
 */
export function wireSelectionCapture(
  container: HTMLElement,
  cb: SelectionCaptureCallback,
  opts: SelectionCaptureOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 200;
  const doc = container.ownerDocument;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const capture = (): void => {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      cb(null, null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      cb(null, null);
      return;
    }
    if (range.toString().trim().length < MIN_SELECTION_LENGTH) {
      cb(null, null);
      return;
    }
    const info = anchorFromSelection(range, container);
    cb(info, info ? range.cloneRange() : null);
  };

  const onMouseUp = (): void => capture();
  const onSelectionChange = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(capture, debounceMs);
  };

  container.addEventListener("mouseup", onMouseUp);
  doc.addEventListener("selectionchange", onSelectionChange);

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    container.removeEventListener("mouseup", onMouseUp);
    doc.removeEventListener("selectionchange", onSelectionChange);
  };
}
