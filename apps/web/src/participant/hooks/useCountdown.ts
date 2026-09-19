import { useEffect, useState } from "react";

import { type Countdown, formatCountdown } from "../format.ts";

/**
 * `specs/behaviors/document-lifecycle.md`: "Within the last 24 hours the
 * countdown updates live." Self-adjusting tick: every second while inside
 * the live window, every minute otherwise (still fresh, far less churn).
 * Re-checks which regime it's in on every tick via `setTimeout` instead of
 * a fixed `setInterval`, so it switches to per-second ticking the moment
 * the deadline crosses into the last 24 hours without waiting on a prop
 * change to re-arm.
 */
export function useCountdown(deadlineIso: string | undefined): Countdown {
  const [countdown, setCountdown] = useState<Countdown>(() =>
    formatCountdown(deadlineIso, new Date()),
  );

  useEffect(() => {
    if (!deadlineIso) {
      return;
    }

    // The first tick is scheduled, not called synchronously here — the
    // `useState` initializer above already computed the value that matches
    // this render; the effect's job is only to keep it fresh afterward
    // ("synchronizing with an external system": the passage of time).
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNext = (previous: Countdown) => {
      timeoutId = setTimeout(
        () => {
          const next = formatCountdown(deadlineIso, new Date());
          setCountdown(next);
          scheduleNext(next);
        },
        previous.isLive ? 1_000 : 60_000,
      );
    };
    scheduleNext(formatCountdown(deadlineIso, new Date()));

    return () => clearTimeout(timeoutId);
  }, [deadlineIso]);

  return countdown;
}
