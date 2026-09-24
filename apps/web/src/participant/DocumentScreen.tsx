import { useParticipantBundle } from "./BundleContext.tsx";
import { DocumentView } from "./components/DocumentView.tsx";
import { useDocumentTitle } from "../lib/useDocumentTitle.ts";

/** `/i/:token` — the current version, per `specs/screens/document.md`. */
export function DocumentScreen(): JSX.Element {
  const { bundle, token, refetch } = useParticipantBundle();
  useDocumentTitle(bundle.document.title, bundle.site.name);
  return (
    <DocumentView
      bundle={bundle}
      token={token}
      refetch={refetch}
      version={bundle.version}
      isCurrent
    />
  );
}
