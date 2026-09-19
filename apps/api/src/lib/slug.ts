/** Slugify a display name into the `^[a-z0-9][a-z0-9-]{1,60}$` shape `people.id` requires. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base.slice(0, 61) : "person";
}

/** Mint a slug guaranteed unique against `isTaken`, appending `-2`, `-3`, … on collision. */
export function uniqueSlug(name: string, isTaken: (candidate: string) => boolean): string {
  const base = slugify(name);
  if (!isTaken(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`uniqueSlug: exhausted retries for base '${base}'`);
}
