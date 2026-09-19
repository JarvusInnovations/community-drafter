import { useState } from "react";

import { copy } from "../copy.ts";

/** `specs/screens/document.md` § Display Rules 2 + "Not you?" action: expands an explanation panel, no state change. */
export function IdentityLine({ name }: { name: string }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 text-sm">
      <span className="text-muted-foreground">
        {copy.identity.prefix} <strong className="font-semibold text-foreground">{name}</strong>
      </span>
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
    </div>
  );
}
