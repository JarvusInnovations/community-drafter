import { type ReactNode } from "react";

import { cn } from "../../lib/utils.ts";

export type PillTone = "muted" | "primary" | "amber" | "ok";

const TONE_CLASSES: Record<PillTone, string> = {
  muted: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary-deep",
  amber: "bg-amber-soft text-amber",
  ok: "bg-ok-soft text-ok",
};

/**
 * `specs/screens/admin-dashboard.md` § Design: the small status/disposition
 * pill used across the people, submissions, versions and activity tables —
 * "status as small pills (unopened muted, opened blue soft, drafting amber
 * soft, commented blue soft, signed green soft, declined muted, revoked
 * muted with strike)" and the submissions-card disposition pills (pending
 * muted, accepted green, partial blue, declined amber, noted muted).
 */
export function Pill({
  tone,
  strike = false,
  children,
}: {
  tone: PillTone;
  /** Revoked rows: "muted with strike" — struck through, not just muted. */
  strike?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
        TONE_CLASSES[tone],
        strike && "line-through",
      )}
    >
      {children}
    </span>
  );
}
