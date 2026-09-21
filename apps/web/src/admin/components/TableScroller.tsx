import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils.ts";
import { copy } from "../copy.ts";
import { cardClass } from "./Card.tsx";

/**
 * `specs/screens/admin-dashboard.md` § Design "Phone width": "A table wider
 * than its card scrolls inside the card and says so in a small line above
 * it." The card already clipped its table, which kept the *page* from
 * scrolling sideways — but a clipped table with no hint just looks like a
 * table missing its last four columns, which is how the simulated run read
 * it (#56). The hint is measured rather than guessed at a breakpoint: the
 * people table is 820 px and still overflows a tablet, while the versions
 * table at 560 px does not.
 *
 * Owning the card markup here (rather than nesting a `Card`) is deliberate:
 * the scrolling element is the card itself, and that is the element whose
 * width has to be measured and, when it scrolls, focused for keyboard
 * users. Both share `cardClass` so there is still one definition of the
 * card look.
 */
export function TableScroller({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const check = (): void => setScrollable(element.scrollWidth > element.clientWidth + 1);
    check();
    // The card is observed for the viewport narrowing; the table inside it
    // for rows arriving, which changes `scrollWidth` without the card ever
    // changing size.
    const observer = new ResizeObserver(check);
    observer.observe(element);
    if (element.firstElementChild) {
      observer.observe(element.firstElementChild);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className={className}>
      {scrollable ? (
        <p className="mb-1.5 text-xs text-muted-foreground">{copy.tableScrollHint}</p>
      ) : null}
      <div
        ref={ref}
        className={cn(cardClass, "overflow-x-auto p-0")}
        {...(scrollable
          ? { tabIndex: 0, role: "region" as const, "aria-label": copy.tableScrollRegion }
          : {})}
      >
        {children}
      </div>
    </div>
  );
}
