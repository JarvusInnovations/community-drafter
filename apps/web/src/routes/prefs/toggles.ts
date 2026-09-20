/**
 * `specs/screens/preferences.md` § Display Rules — the five toggles, in
 * this exact order, with their exact descriptions. Kept as plain data so
 * the order/copy is trivially diffable against the spec and testable
 * without rendering the component.
 */
export type ToggleKey =
  | "every_revision"
  | "daily_digest"
  | "phase_changes"
  | "my_comments_addressed"
  | "reminders";

export interface ToggleDef {
  key: ToggleKey;
  label: string;
  description?: string;
}

export const TOGGLES: readonly ToggleDef[] = [
  {
    key: "every_revision",
    label: "Every new version",
    description: "One email each time the text is revised, with what changed.",
  },
  {
    key: "daily_digest",
    label: "Daily summary",
    description: "At most one email a day, only on days something changed.",
  },
  {
    key: "phase_changes",
    label: "Milestones",
    description:
      "When comments close, when the final text is published, when the signing window closes, and if a deadline moves.",
  },
  {
    key: "my_comments_addressed",
    label: "Replies to my comments",
  },
  {
    key: "reminders",
    label: "Reminders",
    description:
      "A nudge if you haven't acted yet. Turns off by itself once you sign, comment or decline.",
  },
];

export const FORCED_EXPLANATION =
  "Because you signed, we'll always tell you when the final text is published and before the window closes.";

export const ALWAYS_CONFIRM_NOTE = "We'll always confirm when you sign or remove your name.";

/** `specs/screens/preferences.md` § Navigation: "Back to document." */
export const BACK_TO_DOCUMENT = "Back to the document";
