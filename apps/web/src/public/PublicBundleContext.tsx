import { createContext, useContext } from "react";

import { type PublicBundle } from "./types.ts";

export interface PublicBundleContextValue {
  slug: string;
  bundle: PublicBundle;
  /** Re-fetches the bundle (current version) — parity with `useParticipantBundle`, unused in phase 1 (no writes on this tree). */
  refetch: () => Promise<void>;
}

export const PublicBundleContext = createContext<PublicBundleContextValue | null>(null);

/** `PublicLayout` is the loader; every route nested under `/d/:slug/*` reads the shared result through this hook. */
export function usePublicBundle(): PublicBundleContextValue {
  const value = useContext(PublicBundleContext);
  if (!value) {
    throw new Error("usePublicBundle must be used within the /d/:slug route tree");
  }
  return value;
}
