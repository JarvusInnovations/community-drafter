/**
 * Browser-safe entry point (`@signatories/shared/browser`): comment
 * anchoring and the version diff, with no dependency on `unified`/remark/
 * rehype or any Node-only module. Keep this file's import graph limited to
 * `anchor/*` and `diff/*` — the render pipeline in `render/` is server-only
 * and must not be pulled in here (see `packages/shared/src/index.test.ts`
 * for the bundle-size assertion that guards this split).
 */
export * from "./anchor/index.ts";
export * from "./anchor/dom.ts";
export * from "./diff/index.ts";
export type { Block, BlockTag, RenderResult } from "./render/types.ts";
// Pure string logic (NFC + whitespace collapse), browser-safe — needed by
// `apps/web`'s comment-mode to reconstruct `Block[]`-shaped data from the
// live DOM for `computeAnchor` (`render/normalize.ts`'s own doc comment).
export { type NormalizedOffsets, normalizeOffsets, normalizeText } from "./render/normalize.ts";
