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
  readOnly = false,
}: {
  token: string;
  number: number;
  publishedAt: string;
  summary: string;
  isCurrent: boolean;
  currentNumber: number;
  /** Admin "view as" has no `/i/:token` route to link into — render plain text instead. */
  readOnly?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {!isCurrent ? (
        <p className="rounded-xl border border-border bg-muted p-3 text-muted-foreground">
          {copy.olderVersionBanner.reading(number)}{" "}
          {readOnly ? (
            copy.olderVersionBanner.readCurrent(currentNumber)
          ) : (
            <Link to={`/i/${token}`} className="font-semibold underline">
              {copy.olderVersionBanner.readCurrent(currentNumber)}
            </Link>
          )}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span
          className={
            "rounded-full px-2.5 py-0.5 text-xs font-bold " +
            (isCurrent ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground")
          }
        >
          {copy.versionLabel.chip(number, isCurrent)}
        </span>
        <span>{copy.versionLabel.rest(formatAbsolute(publishedAt), summary)}</span>
        {readOnly ? null : (
          <>
            {number > 1 ? (
              <>
                <Link
                  to={`/i/${token}/history/compare?to=${number}`}
                  className="font-medium text-primary"
                >
                  {copy.versionLabel.seeWhatChanged}
                </Link>
              </>
            ) : null}
            <Link to={`/i/${token}/history`} className="font-medium text-primary">
              {copy.versionLabel.allVersions}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
