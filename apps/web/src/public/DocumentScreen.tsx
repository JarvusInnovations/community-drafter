import { usePublicBundle } from "./PublicBundleContext.tsx";
import { PublicDocumentView } from "./components/PublicDocumentView.tsx";
import { useDocumentTitle } from "../lib/useDocumentTitle.ts";

/** `/d/:slug` — `specs/screens/public-and-embed.md` § Display Rules "Public read view". */
export function DocumentScreen(): JSX.Element {
  const { bundle, slug } = usePublicBundle();
  // `specs/screens/public-and-embed.md` § Browser tab: the public view says
  // the document alone — the site is already named in the top bar.
  useDocumentTitle(bundle.document.title);
  return <PublicDocumentView bundle={bundle} slug={slug} />;
}
