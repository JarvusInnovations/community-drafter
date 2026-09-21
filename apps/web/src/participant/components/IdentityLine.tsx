import { useState } from "react";

import { copy } from "../copy.ts";

/**
 * `specs/screens/document.md` § Display Rules 2 + "Not you?" action: expands
 * an explanation panel, no state change. The explanation **names who sent
 * the link** and the address to write to, because "ask whoever sent you
 * this link" leaves a person who has been mistaken for someone else with
 * nobody to ask (#60). `readOnly` (admin "view as") drops
 * the button entirely — `specs/screens/admin-dashboard.md`'s "every action
 * control is disabled" is read literally here: view-as renders zero
 * interactive elements, this disclosure toggle included.
 */
export function IdentityLine({
  name,
  senderName,
  replyTo,
  readOnly = false,
}: {
  name: string;
  /** `specs/screens/document.md` § Display Rules 2 — who sent the link. */
  senderName?: string;
  /** The address to ask for one's own copy. */
  replyTo?: string;
  readOnly?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 text-[0.95rem]">
      <span className="text-muted-foreground">
        {copy.identity.prefix} <strong className="font-semibold text-foreground">{name}</strong>
      </span>
      {readOnly ? null : (
        <>
          {" · "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {copy.identity.notYou}
          </button>
          {open ? (
            <p className="mt-2 rounded-xl border border-border bg-muted p-3 text-sm text-muted-foreground">
              {copy.identity.notYouBody(senderName, replyTo)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
