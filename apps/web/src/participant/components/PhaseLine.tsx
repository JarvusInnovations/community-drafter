import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";
import { useCountdown } from "../hooks/useCountdown.ts";
import { type DocumentInfo } from "../types.ts";

/**
 * `specs/behaviors/document-lifecycle.md` § "The visible clock": absolute
 * time (with zone name) plus a relative countdown, live within 24 h, and
 * the later deadline shown alongside the nearer one during commenting.
 */
export function PhaseLine({ document }: { document: DocumentInfo }): JSX.Element {
  const deadline =
    document.phase === "commenting" ? document.comments_close_at : document.signing_closes_at;
  const isTicking = document.phase === "commenting" || document.phase === "signing";
  const countdown = useCountdown(isTicking ? deadline : undefined);

  if (document.phase === "withdrawn") {
    return <p className="mt-1 text-sm text-muted-foreground">{copy.phase.withdrawnLine}</p>;
  }

  if (document.phase === "closed") {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        {copy.phase.closedLine(formatAbsolute(document.signing_closes_at))}
      </p>
    );
  }

  const label = copy.phase.label(document.phase);
  const line = copy.phase.closesLine(
    label,
    formatAbsolute(deadline),
    countdown.isPast ? "" : countdown.label,
  );

  return (
    <div className="mt-1 text-sm text-muted-foreground">
      <p>{line}</p>
      {document.phase === "commenting" && document.signing_closes_at ? (
        <p>{copy.phase.laterDeadline(formatAbsolute(document.signing_closes_at))}</p>
      ) : null}
    </div>
  );
}
