import { useEffect } from "react";

/**
 * `specs/screens/public-and-embed.md` § Display Rules "Browser tab": a page
 * that shows one document names it in the browser's title rather than
 * leaving the build's generic name there, so a shared link is identifiable
 * in a tab strip, a bookmark and a history entry (#60). Parts are joined
 * with the design's middle dot; empty ones drop out, which is how the
 * public view says the document alone.
 *
 * Restores the previous title on unmount so navigating from a document back
 * to a titleless route (the instance root, the "isn't available" page)
 * doesn't leave the last document's name in the tab.
 */
export function useDocumentTitle(...parts: (string | undefined | null)[]): void {
  const title = parts.filter(Boolean).join(" · ");
  useEffect(() => {
    if (!title) {
      return;
    }
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
