import { useState } from "react";

import { copy } from "../copy.ts";

/**
 * `specs/screens/document.md` § Display Rules 2 + "Not you?" action: expands
 * an explanation panel, no state change. `readOnly` (admin "view as") drops
 * the button entirely — `specs/screens/admin-dashboard.md`'s "every action
 * control is disabled" is read literally here: view-as renders zero
 * interactive elements, this disclosure toggle included.
 */
export function IdentityLine({
  name,
  readOnly = false,
}: {
  name: string;
  readOnly?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 text-sm">
      <span className="text-muted-foreground">
        {copy.identity.prefix} <strong className="font-semibold text-foreground">{name}</strong>
      </span>
      {readOnly ? null : (
        <>
          {" · "}
          <button
            type="button"
            className="text-foreground underline underline-offset-2"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {copy.identity.notYou}
          </button>
          {open ? (
            <p className="mt-1 rounded border border-border bg-muted p-2 text-muted-foreground">
              {copy.identity.notYouBody}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
