import { createContext, useContext } from "react";

import { type Bundle } from "./types.ts";

export interface BundleContextValue {
  token: string;
  bundle: Bundle;
  /** Re-fetches the bundle (current version) after a write, e.g. sign/revoke. */
  refetch: () => Promise<void>;
}

export const BundleContext = createContext<BundleContextValue | null>(null);

/**
 * `plans/participant-sign-flow.md` § Approach: "a loader with a hook
 * fetching `GET /i/:token/api/bundle` once and sharing it." `ParticipantLayout`
 * is the loader; every route nested under `/i/:token/*` reads the shared
 * result through this hook instead of re-fetching.
 */
export function useParticipantBundle(): BundleContextValue {
  const value = useContext(BundleContext);
  if (!value) {
    throw new Error("useParticipantBundle must be used within the /i/:token route tree");
  }
  return value;
}
