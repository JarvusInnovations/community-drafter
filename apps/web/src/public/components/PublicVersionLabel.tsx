import { Link } from "react-router";

import { copy } from "../copy.ts";
import { formatAbsolute } from "../../participant/format.ts";

/**
 * The public read view always shows the current version (there is no
 * public single-older-version route, unlike `/i/:token/v/:n` —
 * `specs/screens/public-and-embed.md`'s route table has no equivalent), so
 * this carries no older-version banner, just the summary line and the two
 * links `../../participant/components/VersionLabel.tsx` also shows,
 * pointed at the public history/compare paths instead of `/i/:token/...`.
 */
export function PublicVersionLabel({
  slug,
  number,
  publishedAt,
  summary,
}: {
  slug: string;
  number: number;
  publishedAt: string;
  summary: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-bold text-ok">
          {copy.versionLabel.chip(number, true)}
        </span>
        <span>{copy.versionLabel.rest(formatAbsolute(publishedAt), summary)}</span>
        {number > 1 ? (
          <>
            {" "}
            ·{" "}
            <Link
              to={`/d/${slug}/history/compare?to=${number}`}
              className="font-medium text-primary"
            >
              {copy.versionLabel.seeWhatChanged}
            </Link>
          </>
        ) : null}{" "}
        ·{" "}
        <Link to={`/d/${slug}/history`} className="font-medium text-primary">
          {copy.versionLabel.allVersions}
        </Link>
      </p>
    </div>
  );
}
