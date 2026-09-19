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
 */
export function DocumentBody({ html }: { html: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }
    container.innerHTML = html;

    for (const heading of container.querySelectorAll<HTMLElement>(
      "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]",
    )) {
      const anchor = document.createElement("a");
      anchor.href = `#${heading.id}`;
      anchor.className = "doc-heading-anchor";
      anchor.setAttribute("aria-label", "Link to this section");
      anchor.textContent = "#";
      heading.prepend(anchor);
    }
  }, [html]);

  return <div ref={ref} className="doc-body mt-4 px-4" />;
}
