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
