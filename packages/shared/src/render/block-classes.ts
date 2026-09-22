import type { Heading, Paragraph, Parent, Root, RootContent, Text } from "mdast";
// Loaded for its module augmentation: `containerDirective` / `leafDirective` /
// `textDirective` are added to mdast's content maps by this package.
import type {} from "mdast-util-directive";

/**
 * The block classes an author may reach for
 * (`specs/behaviors/versioning.md` § Block classes). Four and no more: this
 * is typographic emphasis, not a styling language, and a new entry is a
 * spec change. The list is repeated in the sanitizer schema
 * (`sanitize-schema.ts`), which is what actually enforces it — anything not
 * on the list is discarded there, whichever syntax wrote it.
 */
export const BLOCK_CLASSES = ["lede", "callout", "small", "center"] as const;

export type BlockClass = (typeof BLOCK_CLASSES)[number];

/** A trailing `{.class}` on a paragraph or heading, with the space before it optional. */
const TRAILING_ATTR = /[ \t]*\{\.([A-Za-z][\w-]*)\}[ \t]*$/u;

/** `::: name` (Pandoc's fenced div) normalized to `:::name`, which is what remark-directive parses. */
const SPACED_FENCE = /^([ \t]{0,3}:{3,})[ \t]+([A-Za-z][\w-]*)[ \t]*$/u;
const CODE_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/u;

/**
 * `specs/behaviors/versioning.md` § Block classes: "`:::callout` without the
 * space means the same thing." The reverse is what needs work — authors
 * write Pandoc's `::: callout`, and `remark-directive` wants the name hard
 * against the colons — so the space is closed up before parsing.
 *
 * Only outside fenced code, and only on a line that is nothing but the
 * fence and a name, so a line of prose that happens to start with colons is
 * never rewritten. Indented code is safe by construction: the fence may
 * carry at most three leading spaces.
 */
export function normalizeContainerFences(markdown: string): string {
  if (!markdown.includes(":::")) return markdown;

  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const code = CODE_FENCE.exec(line);
      if (fence !== undefined) {
        if (code && line.trimStart().startsWith(fence)) fence = undefined;
        return line;
      }
      if (code) {
        fence = code[1];
        return line;
      }
      return line.replace(SPACED_FENCE, "$1$2");
    })
    .join("\n");
}

function isBlockClass(value: string): value is BlockClass {
  return (BLOCK_CLASSES as readonly string[]).includes(value);
}

/**
 * Records a class for `remark-rehype`, and only one the spec names. The
 * sanitizer enforces the same list downstream — this check is here so a
 * rejected class leaves no empty `class=""` behind on the element.
 */
function addClass(node: Paragraph | Heading | Parent, value: string): void {
  if (!isBlockClass(value)) return;
  const data = (node.data ??= {});
  const properties = ((data as { hProperties?: Record<string, unknown> }).hProperties ??= {});
  const existing = properties.className;
  properties.className = Array.isArray(existing) ? [...existing, value] : [value];
}

/**
 * Strips the trailing `{.class}` marker off a paragraph or heading and
 * records the class for `remark-rehype`. The marker is authoring syntax, so
 * it comes off whatever the class turns out to be — leaving `{.bogus}`
 * visible in the statement would be a worse failure than dropping it, and
 * the sanitizer is the one place the whitelist is applied.
 */
function takeTrailingAttribute(node: Paragraph | Heading): void {
  const last = node.children.at(-1);
  if (!last || last.type !== "text") return;
  const text = last as Text;
  const match = TRAILING_ATTR.exec(text.value);
  if (!match) return;

  text.value = text.value.slice(0, match.index);
  if (text.value === "") node.children.pop();
  addClass(node, match[1]!);
}

/**
 * `specs/behaviors/versioning.md` § Block classes. Two syntaxes, one
 * whitelist (checked here and enforced again by the sanitizer):
 *
 * - a trailing `{.lede}` on a paragraph or heading;
 * - a `:::callout` … `:::` container, which becomes a plain `div` wrapper.
 *
 * A container is a wrapper and nothing more: `rehype-block-ids` never
 * assigns an id to a `div`, so the paragraphs inside keep the ids and the
 * text they would have had without it.
 *
 * `remark-directive` also parses `:name` and `::name` in running prose as
 * text and leaf directives, which `mdast-util-to-hast` would silently
 * *drop* — a sentence quietly losing words in a published statement. Every
 * directive this plugin does not handle is therefore restored to its
 * literal source text, which is what the author wrote and what a reader
 * expects to see.
 */
export function remarkBlockClasses(options: { source: string }) {
  return (tree: Root): void => {
    const walk = (parent: Parent): void => {
      for (let index = 0; index < parent.children.length; index += 1) {
        const child = parent.children[index] as RootContent;

        if (child.type === "paragraph" || child.type === "heading") {
          takeTrailingAttribute(child);
        }

        if (child.type === "containerDirective") {
          const data = (child.data ??= {});
          (data as { hName?: string }).hName = "div";
          addClass(child, child.name);
        } else if (child.type === "textDirective" || child.type === "leafDirective") {
          const start = child.position?.start.offset;
          const end = child.position?.end.offset;
          parent.children[index] = {
            type: "text",
            value:
              start === undefined || end === undefined
                ? `:${child.name}`
                : options.source.slice(start, end),
          } as RootContent;
          continue;
        }

        if ("children" in child && Array.isArray(child.children)) walk(child as Parent);
      }
    };

    walk(tree);
  };
}
