import { Timeline } from "../../participant/components/Timeline.tsx";
import { type PublicDocumentInfo } from "../types.ts";

/**
 * `specs/screens/public-and-embed.md` § Display Rules "Public read view":
 * "the document screen layout without the status card and identity line" —
 * title and the timeline survive; `IdentityLine` does not (there is
 * no bound person on a public link).
 */
export function PublicDocumentHeader({ document }: { document: PublicDocumentInfo }): JSX.Element {
  return (
    <header className="pt-6">
      <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
        {document.title}
      </h1>
      <Timeline document={document} />
    </header>
  );
}
