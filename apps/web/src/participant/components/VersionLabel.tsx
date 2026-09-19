import { Link } from "react-router";

import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";

/**
 * `specs/screens/document.md` § Display Rules 4: "Version 3 · published
 * Sep 20 at 9:14 AM EDT · *summary* · See what changed · All versions."
 * `isCurrent = false` adds the older-version banner
 * (`specs/screens/document.md` § Route: "the same layout serves
 * `/i/<token>/v/<n>` ... in read-only form").
 */
export function VersionLabel({
  token,
  number,
  publishedAt,
  summary,
  isCurrent,
  currentNumber,
}: {
  token: string;
  number: number;
  publishedAt: string;
  summary: string;
  isCurrent: boolean;
  currentNumber: number;
}): JSX.Element {
  return (
    <div className="mt-3 flex flex-col gap-1 text-sm">
      {!isCurrent ? (
        <p className="rounded border border-border bg-muted p-2 text-muted-foreground">
          {copy.olderVersionBanner.reading(number)}{" "}
          <Link to={`/i/${token}`} className="font-semibold underline">
            {copy.olderVersionBanner.readCurrent(currentNumber)}
          </Link>
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {copy.versionLabel.line(number, formatAbsolute(publishedAt), summary)}
        {number > 1 ? (
          <>
            {" "}
            ·{" "}
            <Link to={`/i/${token}/history/compare?to=${number}`} className="underline">
              {copy.versionLabel.seeWhatChanged}
            </Link>
          </>
        ) : null}{" "}
        ·{" "}
        <Link to={`/i/${token}/history`} className="underline">
          {copy.versionLabel.allVersions}
        </Link>
      </p>
    </div>
  );
}
