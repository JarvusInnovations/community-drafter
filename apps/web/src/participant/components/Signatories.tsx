import { useState } from "react";

import { copy } from "../copy.ts";
import { type SignatoryListItem, type SignatorySummary } from "../types.ts";

const COLLAPSE_AFTER = 20;
const AVATAR_ROW = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

function primary(item: SignatoryListItem): string {
  return item.capacity === "official" ? (item.org ?? item.display_name) : item.display_name;
}

function secondary(item: SignatoryListItem): string {
  if (item.capacity === "official") {
    return item.title ? `${item.display_name}, ${item.title}` : item.display_name;
  }
  return item.descriptor ?? "";
}

/**
 * `specs/screens/document.md` § Design "Signatories card": heading, a row
 * of initial avatars with the counts sentence, then a grid of chips
 * (avatar, name, descriptor or org and title; organization avatars in the
 * deep blue). Ordering and what counts come from the API
 * (`behaviors/signatures.md` § Display).
 */
export function Signatories({
  signatories,
}: {
  signatories: SignatorySummary | null;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  if (!signatories) {
    return null;
  }

  const list = signatories.list;
  const visible = list && !expanded ? list.slice(0, COLLAPSE_AFTER) : list;
  const hiddenCount = list ? list.length - (visible?.length ?? 0) : 0;
  const counts =
    copy.signatories.counts(signatories.organizations, signatories.individuals) +
    (signatories.unlisted > 0 ? `, ${copy.signatories.unlisted(signatories.unlisted)}` : "");

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-base font-bold tracking-tight text-foreground">
        {copy.signatories.heading}
      </h2>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {list && list.length > 0 ? (
          <span className="flex" aria-hidden="true">
            {list.slice(0, AVATAR_ROW).map((item) => (
              <span
                key={`${item.capacity}:${item.org ?? ""}:${item.display_name}:${item.descriptor ?? ""}`}
                className={
                  "grid h-7 w-7 place-items-center rounded-full border-2 border-card text-[11px] font-bold not-first:-ml-1.5 " +
                  (item.capacity === "official"
                    ? "bg-primary-deep text-white"
                    : "bg-primary-soft text-primary-deep")
                }
              >
                {initials(primary(item))}
              </span>
            ))}
          </span>
        ) : null}
        <span>{counts}</span>
      </p>
      {visible ? (
        <>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {visible.map((item) => (
              <li
                key={`${item.capacity}:${item.org ?? ""}:${item.display_name}:${item.descriptor ?? ""}`}
                className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border px-2.5 py-2 text-sm"
              >
                <span
                  aria-hidden="true"
                  className={
                    "grid h-8 w-8 flex-none place-items-center rounded-full text-xs font-bold " +
                    (item.capacity === "official"
                      ? "bg-primary-deep text-white"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {initials(primary(item))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">
                    {primary(item)}
                  </span>
                  {secondary(item) ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {secondary(item)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="mt-3 text-sm font-medium text-primary"
              onClick={() => setExpanded(true)}
            >
              {copy.signatories.showAll}
            </button>
          ) : null}
          {expanded && list && list.length > COLLAPSE_AFTER ? (
            <button
              type="button"
              className="mt-3 text-sm font-medium text-primary"
              onClick={() => setExpanded(false)}
            >
              {copy.signatories.showFewer}
            </button>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{copy.signatories.countsOnly}</p>
      )}
    </section>
  );
}
