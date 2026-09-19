import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

import { rehypeBlockIds } from "./block-ids.ts";
import type { Block, RenderResult } from "./types.ts";

export type { Block, BlockTag, RenderResult } from "./types.ts";
export { normalizeText } from "./normalize.ts";

/**
 * Server-only markdown render pipeline (`specs/behaviors/versioning.md` §
 * Diff step 1, `specs/behaviors/inline-comments.md` § Block identity).
 *
 * `remark-parse` → `remark-gfm` → `remark-rehype` → `rehype-sanitize`
 * (strips raw HTML) → `rehype-slug` (heading anchors) → `rehype-block-ids`
 * (`data-block` ids + block extraction) → `rehype-stringify`.
 *
 * Not part of the browser bundle: pulls in the full unified/remark/rehype
 * toolchain. See `src/browser.ts` for the browser-safe subset (anchors +
 * diff) that a client can import directly.
 */
export function render(markdown: string): RenderResult {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeSlug)
    .use(rehypeBlockIds)
    .use(rehypeStringify)
    .processSync(markdown);

  const blocks: Block[] = file.data.blocks ?? [];

  return {
    html: String(file),
    blocks,
  };
}
