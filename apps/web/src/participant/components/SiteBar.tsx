import { copy } from "../copy.ts";
import { useCountdown } from "../hooks/useCountdown.ts";
import { type DocumentInfo, type SiteInfo } from "../types.ts";

/**
 * `specs/screens/document.md` § Display Rules 1 and § Design "Frame": a
 * slim sticky top bar with the **document's site** — its `logo_url` image
 * when it sets one, otherwise its name, with the name as the accessible
 * name either way (`specs/behaviors/sites.md` § Identity on a surface) —
 * and, when a document is loaded, a live pill ("Comment period · closes in
 * 4d 21h"). The pill uses the one-line clock form from
 * `behaviors/document-lifecycle.md`; the timeline below carries the full
 * picture. Nothing here names the platform or any other site.
 */
export function SiteBar({
  site,
  document,
}: {
  site: SiteInfo;
  document?: Pick<DocumentInfo, "phase" | "comments_close_at" | "signing_closes_at">;
}): JSX.Element {
  const deadline =
    document?.phase === "commenting"
      ? document.comments_close_at
      : document?.phase === "signing"
        ? document.signing_closes_at
        : undefined;
  const countdown = useCountdown(deadline);
  const pill =
    document && (document.phase === "commenting" || document.phase === "signing")
      ? copy.phase.pill(copy.phase.label(document.phase), countdown.isPast ? "" : countdown.label)
      : document
        ? copy.phase.label(document.phase)
        : null;

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 px-5 py-2.5">
        {site.logo_url ? (
          <img
            src={site.logo_url}
            alt={site.name}
            className="max-h-7 w-auto max-w-[220px] object-contain"
          />
        ) : (
          <span className="text-sm font-extrabold tracking-tight text-foreground">
            {copy.siteBar(site.name)}
          </span>
        )}
        {pill ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-deep">
            <span
              className="h-2 w-2 rounded-full bg-primary motion-safe:animate-pulse"
              aria-hidden="true"
            />
            {pill}
          </span>
        ) : null}
      </div>
    </div>
  );
}
