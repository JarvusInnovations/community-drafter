import { createContext, useContext } from "react";

import { type SessionInfo } from "./types.ts";

export interface SessionContextValue {
  session: SessionInfo;
  refetch: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useAdminSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useAdminSession must be used within the /admin route tree");
  }
  return value;
}
