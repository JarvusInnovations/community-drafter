import { usePublicBundle } from "./PublicBundleContext.tsx";
import { PublicDocumentView } from "./components/PublicDocumentView.tsx";

/** `/d/:slug` — `specs/screens/public-and-embed.md` § Display Rules "Public read view". */
export function DocumentScreen(): JSX.Element {
  const { bundle, slug } = usePublicBundle();
  return <PublicDocumentView bundle={bundle} slug={slug} />;
}
