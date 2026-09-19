import { useState } from "react";

import { copy } from "../copy.ts";
import { type SignatoryListItem, type SignatorySummary } from "../types.ts";

const COLLAPSE_AFTER = 20;

/** `specs/behaviors/signatures.md` § Display: capacity-specific display strings. */
function signatoryLabel(item: SignatoryListItem): string {
  if (item.capacity === "official") {
    const who = item.title ? `${item.display_name}, ${item.title}` : item.display_name;
    return `${item.org} — ${who}`;
  }
  return item.descriptor ? `${item.display_name}, ${item.descriptor}` : item.display_name;
}

/**
 * `specs/screens/document.md` § Display Rules 7 +
 * `specs/behaviors/signatures.md` § Display: organizations first
 * (alphabetical), then individuals (chronological — the API already
 * orders `list` this way), collapsed beyond 20 with "show all",
 * `listed = false` signers counted but not named.
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

  return (
    <section className="mx-4 mt-4">
      <h2 className="text-sm font-semibold text-foreground">{copy.signatories.heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {copy.signatories.counts(signatories.organizations, signatories.individuals)}
        {signatories.unlisted > 0 ? `, ${copy.signatories.unlisted(signatories.unlisted)}` : ""}
      </p>
      {visible ? (
        <>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {visible.map((item) => (
              <li
                key={`${item.capacity}:${item.org ?? ""}:${item.display_name}:${item.descriptor ?? ""}`}
                className="text-foreground"
              >
                {signatoryLabel(item)}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="mt-2 text-sm underline"
              onClick={() => setExpanded(true)}
            >
              {copy.signatories.showAll}
            </button>
          ) : null}
          {expanded && list && list.length > COLLAPSE_AFTER ? (
            <button
              type="button"
              className="mt-2 text-sm underline"
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
