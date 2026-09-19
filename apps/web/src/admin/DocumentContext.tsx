import { createContext, useContext } from "react";

import { type DocumentDetail } from "./types.ts";

export interface DocumentContextValue {
  document: DocumentDetail;
  refetch: () => Promise<void>;
}

export const DocumentContext = createContext<DocumentContextValue | null>(null);

export function useAdminDocument(): DocumentContextValue {
  const value = useContext(DocumentContext);
  if (!value) {
    throw new Error("useAdminDocument must be used within the /admin/d/:slug route tree");
  }
  return value;
}
