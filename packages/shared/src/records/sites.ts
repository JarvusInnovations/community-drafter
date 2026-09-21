import { z } from "zod";

import { SLUG_PATTERN } from "./documents.ts";

/**
 * `specs/data-model.md` → `sites`; `specs/behaviors/sites.md`. One record
 * per hostname the deployment answers on, and the identity every
 * participant and public surface of that site's documents carries.
 *
 * The **default site is not a record**: it is derived from the deployment's
 * configuration (`specs/behaviors/sites.md` § The default site) and owns
 * every document whose `site` is absent, so an instance that has never
 * created a site has an empty sheet and behaves exactly as it did before
 * this field existed.
 */

/** A DNS host name: lowercase, no scheme, no port, no path. */
export const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** `specs/behaviors/sites.md`: one token, the site's primary color. */
export const ACCENT_PATTERN = /^#[0-9a-f]{6}$/;

/** The slug reserved for the deployment's own derived site; no record may take it. */
export const DEFAULT_SITE_SLUG = "default";

export const SiteRecordSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN),
  hostname: z.string().regex(HOSTNAME_PATTERN),
  name: z.string().min(1),
  sender_name: z.string().optional(),
  sender_email: z.email().optional(),
  reply_to: z.email(),
  logo_url: z.string().url().startsWith("https://").optional(),
  accent: z.string().regex(ACCENT_PATTERN).optional(),
  /** The site's operator group; never empty (the admin API refuses a removal that would empty it). */
  operators: z.array(z.email()).min(1),
  created_by: z.email(),
});

export type SiteRecord = z.infer<typeof SiteRecordSchema>;
