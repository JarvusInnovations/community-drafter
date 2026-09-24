const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

/** Escapes plain text for inclusion inside HTML content (not attributes). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => ESCAPES[char] ?? char);
}

const VOID_SAFE_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]);

/** Wraps already-escaped `inner` HTML in `<tag data-block="id">…</tag>`. */
export function wrapBlockHtml(tag: string, blockId: string, inner: string): string {
  const safeTag = VOID_SAFE_TAGS.has(tag) ? tag : "p";
  return `<${safeTag} data-block="${blockId}">${inner}</${safeTag}>`;
}

/**
 * Swaps the content of a single already-serialized element, keeping its own
 * open tag (and so its `data-block` id and any alignment `style`) intact.
 * Returns `html` unchanged when it is not a well-formed single element.
 */
export function replaceInnerHtml(html: string, inner: string): string {
  const openEnd = html.indexOf(">");
  const closeStart = html.lastIndexOf("</");
  if (openEnd === -1 || closeStart === -1 || closeStart < openEnd) return html;
  return `${html.slice(0, openEnd + 1)}${inner}${html.slice(closeStart)}`;
}

/** Replaces the first occurrence of `needle`, treating `replacement` literally. */
export function replaceOnce(haystack: string, needle: string, replacement: string): string {
  const at = haystack.indexOf(needle);
  if (at === -1) return haystack;
  return `${haystack.slice(0, at)}${replacement}${haystack.slice(at + needle.length)}`;
}
