/**
 * `specs/screens/preferences.md` § Display Rules — the two toggles, in this
 * exact order, with their exact descriptions. Kept as plain data so the
 * order/copy is trivially diffable against the spec and testable without
 * rendering the component. There are no forced toggles: every message a
 * preference could have forced on is a receipt or an operator's deliberate
 * send (`specs/behaviors/notifications.md` § Defaults).
 */
export type ToggleKey = "my_comments_addressed" | "reminders";

export interface ToggleDef {
  key: ToggleKey;
  label: string;
  description: string;
}

export const TOGGLES: readonly ToggleDef[] = [
  {
    key: "my_comments_addressed",
    label: "Replies to my comments",
    description: "When the team answers your comments in a new version and asks us to tell you.",
  },
  {
    key: "reminders",
    label: "Reminders",
    description:
      "A nudge before a deadline if you haven't answered yet. Turns off by itself once you sign, comment or decline.",
  },
];

/**
 * `specs/screens/preferences.md` § Display Rules: what is always sent, and
 * nothing the system does not send.
 */
export const ALWAYS_SENT_NOTE =
  "We'll always confirm what you do here (signing, removing your name, comments), and the team may write to ask you to confirm your signature, to tell you there is more time to sign, or to say the statement was delivered.";

/** `specs/screens/preferences.md` § Navigation: "Back to document." */
export const BACK_TO_DOCUMENT = "Back to the document";
