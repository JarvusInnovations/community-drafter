import { useParticipantBundle } from "./BundleContext.tsx";
import { DocumentView } from "./components/DocumentView.tsx";

/** `/i/:token` — the current version, per `specs/screens/document.md`. */
export function DocumentScreen(): JSX.Element {
  const { bundle, token, refetch } = useParticipantBundle();
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
