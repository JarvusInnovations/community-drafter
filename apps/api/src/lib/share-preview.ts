import type { FastifyInstance, FastifyRequest } from "fastify";

import { findPublicDocument } from "./public-document.ts";

/**
 * `specs/screens/public-and-embed.md` § Share Preview. A link to this
 * instance is forwarded far more often than it is typed, and every chat
 * client, mail client and crawler that sees one fetches the page
 * unauthenticated and shows whatever its head declares to everyone in the
 * room. So the metadata is held to the same standard as the response body
 * (§ Principles, Local: "A share preview never confirms a document
 * exists"): only a path that resolves to a document an anonymous caller may
 * already read gets document-specific tags, and every other page — a
 * private or unknown slug, a personal link, an admin page, the instance
 * root — gets the same generic instance tags.
 */

/** Used when nothing else is available, and for every non-public page. */
export const GENERIC_DESCRIPTION =
  "Community drafting and signing of collective statements: one link per person, a real deadline, numbered versions, and a truthful list of who signed.";

/** The generic instance card, served from the built web app's dist root. */
const CARD_PATH = "/og.png";

/** `og:description` is a one-liner; anything longer is truncated on the way out anyway. */
const DESCRIPTION_LIMIT = 200;

export interface SharePreview {
  /** `<title>`, `og:title`, `twitter:title`. */
  title: string;
  description: string;
  /** Absolute; `og:url` and the canonical link. */
  url: string;
  /** Absolute. */
  image: string;
  imageAlt: string;
  type: "website" | "article";
  siteName: string;
  /** True for the pages that are nobody's to index: personal links and admin. */
  noindex: boolean;
}

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/gu, (char) => ATTRIBUTE_ESCAPES[char] ?? char);
}

/** Collapses whitespace and cuts at `DESCRIPTION_LIMIT`, on a word boundary. */
function condense(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= DESCRIPTION_LIMIT) return flat;
  const cut = flat.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/u, "")}…`;
}

/** `[text](url)` → `text`, `**bold**` → `bold`, `` `code` `` → `code`. */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/gu, "$1")
    .replace(/`([^`]*)`/gu, "$1");
}

/**
 * The first sentence of a document's text: the description a share preview
 * leads with, because a preview should say what the statement says. Skips
 * the furniture a statement opens with — headings, block quotes, list
 * markers, tables, rules, fenced code — and takes the first real prose
 * line, because a title repeated as the description tells a reader nothing
 * the title did not. Returns `undefined` when the body is all furniture,
 * which is when the version's `summary` takes over.
 */
export function firstSentence(body: string): string | undefined {
  let inFence = false;

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "") continue;
    if (/^(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|[-*_]{3,}$)/u.test(line)) continue;

    const text = stripInlineMarkdown(line).trim();
    if (text === "") continue;

    // A sentence ends at `.`/`!`/`?` followed by a space or the line's end —
    // not at the dot inside "Sec. 4" or "jarv.us", which have no space after.
    const end = /[.!?](\s|$)/u.exec(text);
    return condense(end ? text.slice(0, end.index + 1) : text);
  }

  return undefined;
}

/**
 * The **resolved site's** own name, for `og:site_name` and every generic
 * title (`specs/behaviors/sites.md` § Identity on a surface — no surface
 * carries the platform's name on another site).
 */
export function siteName(request: FastifyRequest): string {
  return request.site.name.trim();
}

/**
 * The resolved site's origin decides every absolute URL in production. The
 * request's own scheme and host is a development fallback only — Open Graph
 * has no relative URLs, and a dev server has no configured address.
 */
export function resolveBaseUrl(request: FastifyRequest): string {
  const configured = request.site.baseUrl.trim();
  if (configured) return configured.replace(/\/+$/u, "");

  const host = request.headers.host ?? "localhost";
  return `${request.protocol}://${host}`;
}

/** The slug in `/d/<slug>…`, or `undefined` for any other path. */
export function publicSlugFromPath(path: string): string | undefined {
  const match = /^\/d\/([^/]+)(?:\/|$)/u.exec(path);
  const raw = match?.[1];
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function genericPreview(
  request: FastifyRequest,
  baseUrl: string,
  { noindex }: { noindex: boolean },
): SharePreview {
  const name = siteName(request);
  return {
    title: name,
    description: GENERIC_DESCRIPTION,
    url: baseUrl,
    image: `${baseUrl}${CARD_PATH}`,
    imageAlt: `${name} — community drafting and signing of collective statements`,
    type: "website",
    siteName: name,
    noindex,
  };
}

/**
 * The tags for one SPA-shell path. Document-specific tags are reachable
 * only through `/d/<slug>` *and* the shared public gate
 * (`lib/public-document.ts`), so there is no path by which a personal link
 * or an admin page grows one: everything else falls through to the generic
 * branch by construction rather than by a check someone has to remember.
 */
export function resolvePreview(
  fastify: FastifyInstance,
  request: FastifyRequest,
  baseUrl: string,
  path: string,
): SharePreview {
  // `specs/screens/public-and-embed.md` § Share Preview: personal-link and
  // admin pages declare `noindex` — the one that carries a credential in
  // its URL must never end up in a crawler's corpus.
  const noindex = /^\/(i|admin|auth)(\/|$)/u.test(path);
  const generic = genericPreview(request, baseUrl, { noindex });

  const slug = publicSlugFromPath(path);
  if (!slug) return generic;

  const document = findPublicDocument(fastify, slug);
  if (!document) return generic;

  // `specs/screens/public-and-embed.md` § Share Preview: the text leads and
  // `summary` is the fallback. A version's `summary` is the one-line
  // changelog of what *changed* in that version — it describes an edit, and
  // to someone meeting the document for the first time in a group chat it
  // describes nothing at all.
  const current = document.versions[document.versions.length - 1];
  const description =
    (current && firstSentence(current.body)) ||
    (current?.summary?.trim() ? condense(current.summary) : GENERIC_DESCRIPTION);

  return {
    ...generic,
    title: document.record.title,
    description,
    // The canonical page is the public read view, whichever of the
    // document's public routes was requested.
    url: `${baseUrl}/d/${encodeURIComponent(document.record.slug)}`,
    type: "article",
  };
}

/** The head fragment for one preview. */
export function renderPreviewTags(preview: SharePreview): string {
  const tag = (attribute: "property" | "name", key: string, value: string) =>
    `<meta ${attribute}="${key}" content="${escapeAttribute(value)}">`;

  const tags = [
    `<title>${escapeAttribute(preview.title)}</title>`,
    tag("name", "description", preview.description),
    `<link rel="canonical" href="${escapeAttribute(preview.url)}">`,
    tag("property", "og:type", preview.type),
    tag("property", "og:site_name", preview.siteName),
    tag("property", "og:title", preview.title),
    tag("property", "og:description", preview.description),
    tag("property", "og:url", preview.url),
    tag("property", "og:image", preview.image),
    tag("property", "og:image:alt", preview.imageAlt),
    tag("property", "og:image:width", "1200"),
    tag("property", "og:image:height", "630"),
    tag("name", "twitter:card", "summary_large_image"),
    tag("name", "twitter:title", preview.title),
    tag("name", "twitter:description", preview.description),
    tag("name", "twitter:image", preview.image),
    tag("name", "twitter:image:alt", preview.imageAlt),
  ];

  if (preview.noindex) tags.push(tag("name", "robots", "noindex, nofollow"));

  return tags.join("\n    ");
}

/**
 * Splices a rendered tag set into the built SPA shell: the shell's own
 * `<title>` is dropped (the preview carries the replacement) and the block
 * goes in immediately before `</head>`, leaving the Vite-built script and
 * stylesheet links untouched. A shell with no `</head>` is returned
 * unchanged rather than corrupted.
 */
export function injectPreviewTags(html: string, tags: string): string {
  const withoutTitle = html.replace(/\s*<title>[\s\S]*?<\/title>/iu, "");
  const headClose = withoutTitle.search(/<\/head>/iu);
  if (headClose === -1) return withoutTitle;

  return `${withoutTitle.slice(0, headClose)}  ${tags}\n  ${withoutTitle.slice(headClose)}`;
}
