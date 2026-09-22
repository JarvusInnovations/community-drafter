import { type ReactNode } from "react";
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
  citations,
}: {
  token: string;
  number: number;
  publishedAt: string;
  summary: string;
  isCurrent: boolean;
  currentNumber: number;
  /** Admin "view as" has no `/i/:token` route to link into — render plain text instead. */
  readOnly?: boolean;
  /**
   * The *Sources as footnotes* toggle (`specs/screens/document.md` § Design
   * "Document card": "on that same line, last"). A slot rather than a prop
   * bundle, so this component stays about the version and knows nothing
   * about how a reader is reading.
   */
  citations?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {!isCurrent ? (
        <p className="rounded-xl border border-border bg-muted p-3 text-muted-foreground">
          {copy.olderVersionBanner.reading(number)}{" "}
          {readOnly ? (
            copy.olderVersionBanner.readCurrent(currentNumber)
          ) : (
            <Link to={`/i/${token}`} className="font-semibold text-primary hover:underline">
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
            <Link to={`/i/${token}/history`} className="font-medium text-primary hover:underline">
              {copy.versionLabel.allVersions}
            </Link>
          </>
        )}
        {citations}
      </p>
    </div>
  );
}
