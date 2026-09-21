/**
 * Shared types and algorithms (anchor computation, diffing, block-id hashing)
 * used by both `apps/api` and `apps/web`.
 *
 * This is the full (server-safe) barrel — it pulls in the `unified`/remark/
 * rehype render pipeline. Browser code that only needs anchors and diffing
 * should import `@signatories/shared/browser` instead (see
 * `src/browser.ts`) to stay out of that dependency graph.
 */
export const SHARED_PACKAGE_NAME = "@signatories/shared";

// render-and-diff
export * from "./render/index.ts";
export * from "./diff/index.ts";
export * from "./anchor/index.ts";

// storage-foundation
export * from "./records/index.ts";
