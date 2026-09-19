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
    <div className="mt-3 flex flex-col gap-1 text-sm">
      <p className="text-muted-foreground">
        {copy.versionLabel.line(number, formatAbsolute(publishedAt), summary)}
        {number > 1 ? (
          <>
            {" "}
            ·{" "}
            <Link to={`/d/${slug}/history/compare?to=${number}`} className="underline">
              {copy.versionLabel.seeWhatChanged}
            </Link>
          </>
        ) : null}{" "}
        ·{" "}
        <Link to={`/d/${slug}/history`} className="underline">
          {copy.versionLabel.allVersions}
        </Link>
      </p>
    </div>
  );
}
