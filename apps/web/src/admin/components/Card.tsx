import { type ReactNode } from "react";

import { cn } from "../../lib/utils.ts";

/**
 * `specs/screens/document.md` § Design (shared token language, inherited by
 * `specs/screens/admin-dashboard.md` § Design): the rounded-2xl, 1px-border,
 * white-card look used throughout the participant screen. Every admin
 * surface (document list, dashboard sections, table wrappers, submission
 * cards) reuses this one primitive rather than re-declaring the class list.
 */
export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** The submissions list needs its cards to be `<li>` elements (see `SubmissionsScreen.tsx`). */
  as?: "div" | "li" | "section";
}): JSX.Element {
  return (
    <Tag className={cn("rounded-2xl border border-border bg-card p-5", className)}>{children}</Tag>
  );
}
