import { usePublicBundle } from "./PublicBundleContext.tsx";
import { PublicDocumentView } from "./components/PublicDocumentView.tsx";
import { useDocumentTitle } from "../lib/useDocumentTitle.ts";

/** `/d/:slug` — `specs/screens/public-and-embed.md` § Display Rules "Public read view". */
export function DocumentScreen(): JSX.Element {
  const { bundle, slug } = usePublicBundle();
  useDocumentTitle(bundle.document.title);
  return <PublicDocumentView bundle={bundle} slug={slug} />;
}
