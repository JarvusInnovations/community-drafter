import { type SiteInfo } from "../types.ts";

/**
 * `specs/behaviors/sites.md` § Identity on a surface: "`accent`, when set,
 * replaces the accent color token; every other token in
 * `screens/document.md` § Design is fixed. A site cannot supply a layout, a
 * typeface or a stylesheet."
 *
 * So exactly one custom property is set, on a wrapper element: every
 * `text-primary` / `bg-primary` utility beneath it resolves
 * `var(--color-primary)` from here instead of from the theme. A site with
 * no accent renders the wrapper with no style at all, which is the default
 * blue.
 */
export function SiteTheme({
  site,
  children,
}: {
  site: Pick<SiteInfo, "accent">;
  children: React.ReactNode;
}): JSX.Element {
  const style = site.accent
    ? ({ "--color-primary": site.accent } as React.CSSProperties)
    : undefined;
  return <div style={style}>{children}</div>;
}
