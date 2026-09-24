import { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeOptions } from "rehype-sanitize";

import { BLOCK_CLASSES } from "./block-classes.ts";

/**
 * The sanitizer schema: GitHub's default, plus exactly the block classes
 * `specs/behaviors/versioning.md` § Block classes allows, and the `div`
 * that a `:::` container renders as.
 *
 * This is where the whitelist is *enforced*. `hast-util-sanitize` reads a
 * `[property, ...allowedValues]` entry as "keep this property only when its
 * value is one of these", so a class the spec does not name is dropped
 * here, whichever of the two authoring syntaxes wrote it, and no other code
 * has to check.
 *
 * Nothing the citation transform adds passes through here: that plugin runs
 * after sanitizing, on markup this package builds itself.
 */
export const RENDER_SANITIZE_SCHEMA: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "div"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), ["className", ...BLOCK_CLASSES]],
  },
};
