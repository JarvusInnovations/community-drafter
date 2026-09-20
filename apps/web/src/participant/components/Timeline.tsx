import { copy } from "../copy.ts";
import { formatAbsolute, formatDateOnly } from "../format.ts";
import { useCountdown } from "../hooks/useCountdown.ts";
import { type DocumentInfo } from "../types.ts";

/**
 * Only the fields the timeline reads, so the public header (which has a
 * smaller document shape) can pass its own document straight through.
 */
export type TimelineDocument = Pick<
  DocumentInfo,
  "phase" | "opened_at" | "comments_close_at" | "signing_closes_at"
>;

type SegmentState = "done" | "active" | "pending";

/** A segment never gets narrower than this share of the track, so a short period stays legible. */
const MIN_SEGMENT = 0.28;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * `specs/screens/document.md` § Header "Timeline" and
 * `specs/behaviors/document-lifecycle.md` § "The visible clock": both
 * deadlines at once, as a track with three labeled points and a marker for
 * now, plus two live countdown chips. Segment state is encoded as fill
 * pattern and label, never hue alone.
 */
export function Timeline({
  document,
  now: nowProp,
}: {
  document: TimelineDocument;
  now?: Date;
}): JSX.Element {
  const now = nowProp ?? new Date();
  const commentsCountdown = useCountdown(document.comments_close_at);
  const signingCountdown = useCountdown(document.signing_closes_at);

  if (document.phase === "withdrawn") {
    return <p className="mt-1 text-sm text-muted-foreground">{copy.phase.withdrawnLine}</p>;
  }

  const closeAt = document.comments_close_at ? new Date(document.comments_close_at) : null;
  const dueAt = document.signing_closes_at ? new Date(document.signing_closes_at) : null;

  if (document.phase === "draft" || !closeAt || !dueAt) {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        {copy.timeline.notOpen}
        {closeAt
          ? ` · ${copy.timeline.commentsClose} ${formatDateOnly(document.comments_close_at)}`
          : ""}
        {dueAt
          ? ` · ${copy.timeline.signaturesDue} ${formatDateOnly(document.signing_closes_at)}`
          : ""}
      </p>
    );
  }

  // Start of the track: when the document opened, else a week before comments close.
  const startAt = document.opened_at
    ? new Date(document.opened_at)
    : new Date(closeAt.getTime() - 7 * 24 * 60 * 60 * 1000);

  const commentSpan = Math.max(1, closeAt.getTime() - startAt.getTime());
  const signingSpan = Math.max(1, dueAt.getTime() - closeAt.getTime());
  const commentShare = clamp(
    commentSpan / (commentSpan + signingSpan),
    MIN_SEGMENT,
    1 - MIN_SEGMENT,
  );
  const signingShare = 1 - commentShare;

  const commentState: SegmentState =
    document.phase === "commenting" ? "active" : now < startAt ? "pending" : "done";
  const signingState: SegmentState =
    document.phase === "signing" ? "active" : document.phase === "closed" ? "done" : "pending";

  let nowShare: number;
  if (now <= startAt) {
    nowShare = 0;
  } else if (now <= closeAt) {
    nowShare = ((now.getTime() - startAt.getTime()) / commentSpan) * commentShare;
  } else if (now <= dueAt) {
    nowShare = commentShare + ((now.getTime() - closeAt.getTime()) / signingSpan) * signingShare;
  } else {
    nowShare = 1;
  }

  const commentsPast = commentsCountdown.isPast || document.phase !== "commenting";
  const signingPast = signingCountdown.isPast || document.phase === "closed";

  return (
    <section
      aria-label={copy.timeline.ariaLabel}
      className="mt-4 rounded-2xl border border-border bg-card p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <Chip
          active={commentState === "active"}
          title={commentsPast ? copy.timeline.commentsClosed : copy.timeline.commentsClose}
          relative={
            commentsPast
              ? formatDateOnly(document.comments_close_at)
              : copy.timeline.inLabel(commentsCountdown.label)
          }
          absolute={formatAbsolute(document.comments_close_at)}
          state={commentState}
        />
        <Chip
          active={signingState === "active"}
          title={signingPast ? copy.timeline.signingClosed : copy.timeline.signaturesDue}
          relative={
            signingPast
              ? formatDateOnly(document.signing_closes_at)
              : copy.timeline.inLabel(signingCountdown.label)
          }
          absolute={formatAbsolute(document.signing_closes_at)}
          state={signingState}
        />
      </div>

      <div className="relative mt-6 pb-9">
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-border"
          role="presentation"
        >
          <Segment state={commentState} share={commentShare} />
          <Segment state={signingState} share={signingShare} />
        </div>

        <Point
          share={0}
          label={copy.timeline.opened}
          date={formatDateOnly(startAt.toISOString())}
          align="start"
        />
        <Point
          share={commentShare}
          label={copy.timeline.commentsClose}
          date={formatDateOnly(document.comments_close_at)}
          align="center"
        />
        <Point
          share={1}
          label={copy.timeline.signaturesDue}
          date={formatDateOnly(document.signing_closes_at)}
          align="end"
        />

        <div
          className="absolute -top-2 h-6 w-[3px] -translate-x-1/2 rounded bg-foreground"
          style={{ left: `${nowShare * 100}%` }}
          aria-hidden="true"
        >
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider text-foreground">
            {copy.timeline.now}
          </span>
        </div>
        <span className="sr-only">{copy.timeline.nowSr(document.phase)}</span>
      </div>
    </section>
  );
}

function Chip({
  active,
  title,
  relative,
  absolute,
  state,
}: {
  active: boolean;
  title: string;
  relative: string;
  absolute: string;
  state: SegmentState;
}): JSX.Element {
  return (
    <div
      data-state={state}
      className={
        "rounded-xl border px-3 py-2.5 " +
        (active ? "border-primary bg-primary-soft" : "border-border bg-muted")
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p
        className={
          "text-lg font-bold leading-tight tracking-tight " +
          (active ? "text-primary-deep" : "text-foreground")
        }
      >
        {relative}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{absolute}</p>
    </div>
  );
}

function Segment({ state, share }: { state: SegmentState; share: number }): JSX.Element {
  const base = "h-full";
  const look =
    state === "done"
      ? "bg-ok"
      : state === "active"
        ? "text-primary"
        : "border border-dashed border-muted-foreground/50 bg-transparent";
  return (
    <div
      data-state={state}
      className={`${base} ${look}`}
      style={{
        width: `${share * 100}%`,
        ...(state === "active"
          ? {
              backgroundImage:
                "repeating-linear-gradient(45deg, currentColor 0 7px, color-mix(in srgb, currentColor 35%, transparent) 7px 14px)",
            }
          : {}),
      }}
    />
  );
}

function Point({
  share,
  label,
  date,
  align,
}: {
  share: number;
  label: string;
  date: string;
  align: "start" | "center" | "end";
}): JSX.Element {
  const translate =
    align === "start" ? "" : align === "center" ? "-translate-x-1/2" : "-translate-x-full";
  const text = align === "start" ? "text-left" : align === "center" ? "text-center" : "text-right";
  return (
    <div
      className={`absolute top-4 w-[34%] ${translate} ${text} text-xs leading-tight text-muted-foreground`}
      style={{ left: `${share * 100}%` }}
    >
      <span className="block font-medium text-foreground">{label}</span>
      <span className="block">{date}</span>
    </div>
  );
}
