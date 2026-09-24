/**
 * Comment anchoring: computing an anchor from a selection and re-anchoring
 * it against another version's blocks, per
 * `specs/behaviors/inline-comments.md`. Pure string/array logic — no DOM, no
 * Node-only APIs — so it belongs in the browser bundle (see `src/browser.ts`).
 * The DOM-only capture/placement helpers live in `anchor/dom.ts`, a separate
 * entry point kept import-safe under Bun (no top-level DOM access).
 */
export { CONTEXT_WINDOW, computeAnchor } from "./compute.ts";
export type { ComputeAnchorInput } from "./compute.ts";
export { placeAnchor } from "./place.ts";
export type { Anchor, AnchorPlacement, PlacementConfidence } from "./types.ts";
