import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

import { normalizeContainerFences, remarkBlockClasses } from "./block-classes.ts";
import { rehypeBlockIds } from "./block-ids.ts";
import { rehypeCitations, type CitationsMode } from "./citations.ts";
import { RENDER_SANITIZE_SCHEMA } from "./sanitize-schema.ts";
import type { Block, RenderOptions, RenderResult } from "./types.ts";

export type { Block, BlockTag, RenderOptions, RenderResult } from "./types.ts";
export { normalizeText } from "./normalize.ts";
export { BLOCK_CLASSES, type BlockClass } from "./block-classes.ts";
export {
  CITATION_MODES,
  canonicalCitationUrl,
  parseCitationsMode,
  type CitationsMode,
} from "./citations.ts";

/**
 * Server-only markdown render pipeline (`specs/behaviors/versioning.md` §
 * Rendering, § Diff step 1, `specs/behaviors/inline-comments.md` § Block
 * identity).
 *
 * `remark-parse` → `remark-gfm` → `remark-directive` + `remark-block-classes`
 * (the `{.class}` suffix and `:::` containers) → `remark-rehype` →
 * `rehype-sanitize` (strips raw HTML, enforces the class whitelist) →
 * `rehype-slug` (heading anchors) → `rehype-block-ids` (`data-block` ids +
 * block extraction) → `rehype-citations` → `rehype-stringify`.
 *
 * **Citations come last on purpose.** § Rendering's first rule is that
 * block identity is invariant: the blocks are extracted before the citation
 * transform runs, so the ids, the normalized text and the per-block HTML
 * are byte-identical in all three modes, and the Sources section the
 * transform appends is not a commentable block. A comment anchored while
 * one reader had footnotes on still lands in the same place for a reader
 * who has them off.
 *
 * Not part of the browser bundle: pulls in the full unified/remark/rehype
 * toolchain. See `src/browser.ts` for the browser-safe subset (anchors +
 * diff) that a client can import directly.
 */
export function render(markdown: string, options: RenderOptions = {}): RenderResult {
  const citations: CitationsMode = options.citations ?? "links";
  const source = normalizeContainerFences(markdown);

  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkBlockClasses, { source })
    .use(remarkRehype)
    .use(rehypeSanitize, RENDER_SANITIZE_SCHEMA)
    .use(rehypeSlug)
    .use(rehypeBlockIds)
    .use(rehypeCitations, { mode: citations })
    .use(rehypeStringify)
    .processSync(source);

  const blocks: Block[] = file.data.blocks ?? [];

  return {
    html: String(file),
    blocks,
  };
}
