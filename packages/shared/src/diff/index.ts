import { diffWordsWithSpace } from "diff";

import type { Block, ComparableVersion } from "../render/types.ts";
import { alignBlocks } from "./align.ts";
import { escapeHtml, replaceInnerHtml, replaceOnce, wrapBlockHtml } from "./html.ts";
import type { DiffUnit, DiffUnitKind, TableUnit } from "./units.ts";
import { toUnits } from "./units.ts";

export type { AlignedOp, Alignable } from "./align.ts";
export { SIMILARITY_THRESHOLD } from "./align.ts";
export { textSimilarity } from "./similarity.ts";
export type { BlockUnit, CodeUnit, DiffUnit, DiffUnitKind, TableUnit } from "./units.ts";
export { toUnits } from "./units.ts";

export type BlockDiffStatus = "same" | "changed" | "added" | "removed";

export interface BlockDiff {
  status: BlockDiffStatus;
  id: string;
  html: string;
  /**
   * Text is unchanged but presentation differs (heading level, list marker):
   * a formatting-only change per `specs/behaviors/versioning.md` § Diff step
   * 6. UI shows a marginal note, not a redline.
   */
  format_only?: boolean;
}

export type DiffChange = "changed" | "added" | "removed";

/** One clause of the summary line: "2 paragraphs changed". */
export interface DiffSummaryItem {
  kind: DiffUnitKind;
  change: DiffChange;
  count: number;
}

export interface DiffSummary {
  changed: number;
  added: number;
  removed: number;
  /**
   * The summary line's clauses, changed kinds first, then added, then
   * removed (`specs/behaviors/versioning.md` § Diff). Empty when the two
   * versions render identically.
   */
  items: DiffSummaryItem[];
}

export interface DiffResult {
  summary: DiffSummary;
  blocks: BlockDiff[];
}

const CHANGE_ORDER: DiffChange[] = ["changed", "added", "removed"];
const KIND_ORDER: DiffUnitKind[] = ["paragraph", "heading", "list item", "table", "code block"];

function isFormatChange(from: Block, to: Block): boolean {
  return from.tag !== to.tag || from.ordered !== to.ordered;
}

/**
 * True when gluing `left` to `right` would run two words together. Word-level
 * diffs hand back a deletion and its replacement back to back with the shared
 * whitespace assigned to neither, so `<del>four</del><ins>five</ins>` reads as
 * "fourfive" — `specs/behaviors/versioning.md` § Diff step 3 forbids that.
 */
function wouldRunTogether(left: string, right: string): boolean {
  if (left === "" || right === "") return false;
  return !/\s$/.test(left) && !/^\s/.test(right);
}

/** Word-level redline of `fromText` → `toText` as escaped `<del>`/`<ins>` runs. */
function redlineInner(fromText: string, toText: string): string {
  let html = "";
  let previous: { tag: "del" | "ins" | ""; value: string } | undefined;

  for (const part of diffWordsWithSpace(fromText, toText)) {
    if (part.value === "") continue;
    const tag = part.added ? "ins" : part.removed ? "del" : "";

    // Only a deletion meeting an insertion (in either order) needs the guard:
    // unchanged text always keeps the whitespace it came with.
    if (
      previous &&
      previous.tag !== "" &&
      tag !== "" &&
      previous.tag !== tag &&
      wouldRunTogether(previous.value, part.value)
    ) {
      html += " ";
    }

    const escaped = escapeHtml(part.value);
    html += tag === "" ? escaped : `<${tag}>${escaped}</${tag}>`;
    previous = { tag, value: part.value };
  }

  return html;
}

function redlineBlockHtml(from: Block, to: Block): string {
  return wrapBlockHtml(to.tag, to.id, redlineInner(from.text, to.text));
}

function sameShape(from: TableUnit, to: TableUnit): boolean {
  const a = from.container.shape;
  const b = to.container.shape;
  return (
    a.length === b.length &&
    a.every((cells, row) => cells === b[row]) &&
    from.cells.length === to.cells.length
  );
}

/**
 * A table that kept its shape is shown once, as the new table with its
 * changed cells redlined in place; a table whose shape changed is shown
 * twice, stacked and labelled (`specs/behaviors/versioning.md` § Diff step
 * 4). The labels are markup, not chrome, because the redline is rendered
 * server-side (`specs/architecture.md`) and the spec requires the stacked
 * pair to be distinguishable without color.
 */
function redlineTableHtml(from: TableUnit, to: TableUnit): string {
  if (sameShape(from, to)) {
    let html = to.container.html;
    for (const [index, toCell] of to.cells.entries()) {
      const fromCell = from.cells[index];
      if (!fromCell || fromCell.text === toCell.text) continue;
      html = replaceOnce(
        html,
        toCell.html,
        replaceInnerHtml(toCell.html, redlineInner(fromCell.text, toCell.text)),
      );
    }
    return html;
  }

  return stackedHtml(to.id, from.container.html, to.container.html);
}

/**
 * The whole old unit struck and labelled "Removed" above the whole new unit
 * underlined and labelled "Added" (`specs/behaviors/versioning.md` § Diff
 * steps 4 and 5): a restructured table, or any changed code block.
 */
function stackedHtml(id: string, fromHtml: string, toHtml: string): string {
  return [
    `<div class="diff-stack" data-block="${id}">`,
    '<p class="diff-stack-label" data-change="removed">Removed</p>',
    `<del class="diff-stack-old">${fromHtml}</del>`,
    '<p class="diff-stack-label" data-change="added">Added</p>',
    `<ins class="diff-stack-new">${toHtml}</ins>`,
    "</div>",
  ].join("");
}

function unitHtml(unit: DiffUnit): string {
  if (unit.type === "table") return unit.container.html;
  if (unit.type === "code") return unit.code.html;
  return unit.block.html;
}

function asComparable(version: Block[] | ComparableVersion): ComparableVersion {
  return Array.isArray(version) ? { blocks: version } : version;
}

/** Tallies the summary line's clauses in the order the spec prints them. */
function summarize(tally: Map<string, DiffSummaryItem>): DiffSummary {
  const items: DiffSummaryItem[] = [];
  for (const change of CHANGE_ORDER) {
    for (const kind of KIND_ORDER) {
      const item = tally.get(`${change}:${kind}`);
      if (item) items.push(item);
    }
  }

  const total = (change: DiffChange): number =>
    items.filter((item) => item.change === change).reduce((sum, item) => sum + item.count, 0);

  return {
    changed: total("changed"),
    added: total("added"),
    removed: total("removed"),
    items,
  };
}

/**
 * Unit-aligned redline between two versions' rendered blocks, per
 * `specs/behaviors/versioning.md` § Diff. Browser-safe: operates on already
 * rendered blocks, not markdown (no `unified` dependency). Pass a render
 * result (or `{ blocks, code }`) to include code blocks; a bare `Block[]`
 * compares the commentable blocks alone.
 */
export function diffVersions(
  fromVersion: Block[] | ComparableVersion,
  toVersion: Block[] | ComparableVersion,
): DiffResult {
  const older = asComparable(fromVersion);
  const newer = asComparable(toVersion);
  const ops = alignBlocks(toUnits(older.blocks, older.code), toUnits(newer.blocks, newer.code));

  const tally = new Map<string, DiffSummaryItem>();
  const count = (kind: DiffUnitKind, change: DiffChange): void => {
    const key = `${change}:${kind}`;
    const existing = tally.get(key);
    if (existing) existing.count += 1;
    else tally.set(key, { kind, change, count: 1 });
  };

  const blocks: BlockDiff[] = [];

  for (const op of ops) {
    if (op.type === "removed") {
      count(op.from.kind, "removed");
      blocks.push({ status: "removed", id: op.from.id, html: unitHtml(op.from) });
      continue;
    }
    if (op.type === "added") {
      count(op.to.kind, "added");
      blocks.push({ status: "added", id: op.to.id, html: unitHtml(op.to) });
      continue;
    }

    const { from, to } = op;

    if (from.type === "table" && to.type === "table") {
      if (from.text === to.text) {
        blocks.push({ status: "same", id: to.id, html: to.container.html });
        continue;
      }
      count(to.kind, "changed");
      blocks.push({ status: "changed", id: to.id, html: redlineTableHtml(from, to) });
      continue;
    }

    if (from.type === "code" && to.type === "code") {
      if (from.text === to.text) {
        blocks.push({ status: "same", id: to.id, html: to.code.html });
        continue;
      }
      count(to.kind, "changed");
      blocks.push({
        status: "changed",
        id: to.id,
        html: stackedHtml(to.id, from.code.html, to.code.html),
      });
      continue;
    }

    if (from.type === "block" && to.type === "block") {
      const textChanged = from.block.text !== to.block.text;
      if (!textChanged && !isFormatChange(from.block, to.block)) {
        blocks.push({ status: "same", id: to.id, html: to.block.html });
        continue;
      }
      count(to.kind, "changed");
      if (!textChanged) {
        // Same text, different presentation: flag, don't redline.
        blocks.push({ status: "changed", id: to.id, html: to.block.html, format_only: true });
        continue;
      }
      blocks.push({ status: "changed", id: to.id, html: redlineBlockHtml(from.block, to.block) });
      continue;
    }

    // A table aligned against a paragraph on similarity alone: too little in
    // common to redline, so show each one whole.
    count(from.kind, "removed");
    count(to.kind, "added");
    blocks.push({ status: "removed", id: from.id, html: unitHtml(from) });
    blocks.push({ status: "added", id: to.id, html: unitHtml(to) });
  }

  return { summary: summarize(tally), blocks };
}
