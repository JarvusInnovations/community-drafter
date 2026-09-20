/**
 * Shared Tailwind class strings for the admin restyle
 * (`specs/screens/admin-dashboard.md` § Design, itself inheriting
 * `specs/screens/document.md` § Design's token language). Centralized here
 * because every dialog, filter toolbar and form field on `/admin/*` wants
 * the identical rounded-input / primary-button / quiet-link look, and
 * repeating the class list at each call site invites drift.
 */

export const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground";

export const selectClass =
  "rounded-xl border border-border bg-card px-2.5 py-1.5 text-sm text-foreground";

export const labelClass = "flex flex-col gap-1 text-sm font-semibold text-muted-foreground";

export const primaryButtonClass =
  "rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white shadow-[0_8px_18px_rgba(36,87,245,0.28)] disabled:opacity-60";

export const quietButtonClass =
  "rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-60";

/** Row actions and other in-line "quiet blue links". */
export const quietLinkClass =
  "text-sm font-medium text-primary hover:underline disabled:opacity-40";

/** A removable active-filter chip (`specs/screens/admin-dashboard.md` § Design). */
export const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground";
