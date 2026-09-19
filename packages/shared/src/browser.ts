/**
 * Browser-safe entry point (`@community-drafter/shared/browser`): comment
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
