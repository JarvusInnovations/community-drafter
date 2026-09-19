import { PhaseLine } from "../../participant/components/PhaseLine.tsx";
import { type PublicDocumentInfo } from "../types.ts";

/**
 * `specs/screens/public-and-embed.md` § Display Rules "Public read view":
 * "the document screen layout without the status card and identity line" —
 * title and the phase/clock line survive; `IdentityLine` does not (there is
 * no bound person on a public link).
 */
export function PublicDocumentHeader({ document }: { document: PublicDocumentInfo }): JSX.Element {
  return (
    <header className="px-4 pt-4">
      <h1 className="text-2xl font-bold text-foreground">{document.title}</h1>
      <PhaseLine document={document} />
    </header>
  );
}
