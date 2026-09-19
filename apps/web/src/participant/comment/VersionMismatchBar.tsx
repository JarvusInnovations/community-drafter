import { copy } from "../copy.ts";

/**
 * `specs/screens/comment-mode.md` § Version mismatch: "if the draft's
 * version is older than current, a bar offers 'Keep commenting on v2' or
 * 'Move my comments to v3'."
 */
export function VersionMismatchBar({
  draftVersion,
  currentVersion,
  onKeep,
  onMove,
  moving,
}: {
  draftVersion: number;
  currentVersion: number;
  onKeep: () => void;
  onMove: () => void;
  moving: boolean;
}): JSX.Element {
  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950/40">
      <span>{copy.commentMode.mismatch.message(draftVersion, currentVersion)}</span>
      <span className="flex gap-3">
        <button type="button" className="underline" onClick={onKeep} disabled={moving}>
          {copy.commentMode.mismatch.keep(draftVersion)}
        </button>
        <button
          type="button"
          className="font-semibold underline"
          onClick={onMove}
          disabled={moving}
        >
          {copy.commentMode.mismatch.move(currentVersion)}
        </button>
      </span>
    </div>
  );
}
