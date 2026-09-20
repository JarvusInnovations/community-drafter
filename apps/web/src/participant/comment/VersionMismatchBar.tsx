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
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-l-[3px] border-amber bg-amber-soft px-3 py-2.5 text-sm text-muted-foreground">
      <span>{copy.commentMode.mismatch.message(draftVersion, currentVersion)}</span>
      <span className="flex gap-4 text-foreground">
        <button
          type="button"
          className="underline disabled:opacity-60"
          onClick={onKeep}
          disabled={moving}
        >
          {copy.commentMode.mismatch.keep(draftVersion)}
        </button>
        <button
          type="button"
          className="font-semibold underline disabled:opacity-60"
          onClick={onMove}
          disabled={moving}
        >
          {copy.commentMode.mismatch.move(currentVersion)}
        </button>
      </span>
    </div>
  );
}
