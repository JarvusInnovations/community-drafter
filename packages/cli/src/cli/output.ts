import { encode } from "@toon-format/toon";

/**
 * TOON rendering helpers (`specs/api/admin-cli.md`, the `axi` skill §§1–5).
 * Ported from the pattern proven in sibling `*-axi` tools (squadquest-axi,
 * specops): a small schema DSL for list columns, plus object/help/list
 * renderers composed with `joinBlocks`.
 */

export interface FieldDef<T> {
  name: string;
  extract: (item: T) => unknown;
}

/** Compute a column from the whole item (derived values). */
export function computed<T>(name: string, fn: (item: T) => unknown): FieldDef<T> {
  return { name, extract: fn };
}

/**
 * Render a list of items as a TOON table with the given field schema.
 * Returns a raw TOON string (not wrapped further) so it composes into a
 * larger output.
 */
export function renderList<T>(name: string, items: T[], schema: Array<FieldDef<T>>): string {
  const projected = items.map((item) =>
    Object.fromEntries(schema.map((f) => [f.name, f.extract(item) ?? ""])),
  );
  return encode({ [name]: projected });
}

/** Render a simple key/value object as TOON. */
export function renderObject(value: object): string {
  return encode(value as Record<string, unknown>);
}

/**
 * Drop `undefined`-valued keys from an object before rendering, so a detail
 * view only shows fields the API actually returned rather than an explicit
 * `field: undefined`.
 */
export function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Render a help array as a multi-line `help[N]:` block — the canonical AXI
 * form (§9). Formatted manually because `encode()` inlines primitive
 * arrays; the multi-line block is the readable standard. Empty help
 * renders to an empty string.
 */
export function renderHelp(suggestions: string[]): string {
  if (suggestions.length === 0) return "";
  return `help[${suggestions.length}]:\n${suggestions.map((s) => `  ${s}`).join("\n")}`;
}

/** Join rendered blocks with newlines, dropping empty ones. */
export function joinBlocks(...blocks: string[]): string {
  return blocks.filter((b) => b.length > 0).join("\n");
}

/**
 * Render an arbitrary value as raw JSON — the `--json` escape hatch
 * (`specs/api/admin-cli.md`: "TOON output by default, `--json` for raw").
 */
export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
