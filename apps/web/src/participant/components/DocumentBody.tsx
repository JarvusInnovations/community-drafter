import { useEffect, useRef } from "react";

/**
 * `specs/screens/document.md` § Display Rules 5: "rendered markdown,
 * readable typography, max line length for prose, headings with anchor
 * links. No highlights in this view." `version.html` is sanitized
 * server-side (`specs/architecture.md` § API server: `rehype-sanitize`) —
 * this component only injects it, into a stable ref'd container (rather
 * than `dangerouslySetInnerHTML`) so a later plan (comment mode) can query
 * this same DOM for selection/anchor placement
 * (`specs/architecture.md` § Web app: "framework-agnostic DOM code ...
 * invoked from a hook").
 *
 * Server rendering (`remark`/`rehype-slug`) gives every heading a stable
 * `id` but no visible anchor link; this adds one client-side per heading so
 * "headings with anchor links" holds without a heavier rehype plugin.
 *
 * Two participant accessibility fixes (#72) live here:
 * - Each anchor's accessible name is "Link to <heading text>", not a
 *   generic string repeated on every heading — and the heading itself gets
 *   an explicit `aria-label` set to its own visible text, so the anchor
 *   (prepended as the heading's first child) can never contribute to, or
 *   otherwise swallow, the heading's own accessible name.
 * - `demoteFirstHeading` (admin "view as" only, via `DocumentView`'s
 *   `readOnly`) retags a leading `<h1>` to `<h2>` so the read-only preview
 *   never has two `<h1>`s on the page (`specs/screens/admin-dashboard.md`
 *   § "View as").
 */
export function DocumentBody({
  html,
  demoteFirstHeading = false,
}: {
  html: string;
  demoteFirstHeading?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }
    container.innerHTML = html;

    if (demoteFirstHeading) {
      const firstHeading = container.querySelector("h1");
      if (firstHeading) {
        const replacement = document.createElement("h2");
        replacement.id = firstHeading.id;
        while (firstHeading.firstChild) {
          replacement.append(firstHeading.firstChild);
        }
        firstHeading.replaceWith(replacement);
      }
    }

    for (const heading of container.querySelectorAll<HTMLElement>(
      "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]",
    )) {
      const headingText = heading.textContent?.trim();
      const anchor = document.createElement("a");
      anchor.href = `#${heading.id}`;
      anchor.className = "doc-heading-anchor";
      anchor.setAttribute(
        "aria-label",
        headingText ? `Link to ${headingText}` : "Link to this section",
      );
      anchor.textContent = "#";
      if (headingText) {
        heading.setAttribute("aria-label", headingText);
      }
      heading.prepend(anchor);
    }
  }, [html, demoteFirstHeading]);

  return <div ref={ref} className="doc-body mt-4" />;
}
