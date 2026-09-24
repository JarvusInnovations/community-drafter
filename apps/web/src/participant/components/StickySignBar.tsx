import { type RefObject, useEffect, useState } from "react";

import { copy } from "../copy.ts";

/**
 * `specs/screens/document.md` § Design "Layout": on narrow screens "a sticky
 * bottom bar ('Add your name' / 'Sign as Alex Kim' + Sign button) appears
 * only while the panel is scrolled out of view." Pressing Sign scrolls the
 * action panel back into view; the panel itself is the only place a
 * signature is created, so the default path stays one form.
 */
export function StickySignBar({
  panelRef,
  name,
  enabled,
}: {
  panelRef: RefObject<HTMLElement | null>;
  name: string;
  enabled: boolean;
}): JSX.Element | null {
  const [panelVisible, setPanelVisible] = useState(true);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setPanelVisible(entry.isIntersecting);
      },
      { threshold: 0.05 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panelRef, enabled]);

  if (!enabled || panelVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:hidden">
      <div className="mx-auto flex max-w-[1120px] items-center gap-3">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
          {copy.stickyBar.label}
          <span className="block truncate font-bold text-foreground">
            {copy.signForm.signButton(name)}
          </span>
        </div>
        <button
          type="button"
          className="rounded-xl bg-primary px-4 py-2.5 font-bold text-white"
          onClick={() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          {copy.stickyBar.button}
        </button>
      </div>
    </div>
  );
}
