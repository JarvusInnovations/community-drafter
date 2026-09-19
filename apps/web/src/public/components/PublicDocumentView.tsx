import { AskTeamCard } from "./AskTeamCard.tsx";
import { PublicDocumentHeader } from "./PublicDocumentHeader.tsx";
import { PublicVersionLabel } from "./PublicVersionLabel.tsx";
import { type PublicBundle } from "../types.ts";
import { DocumentBody } from "../../participant/components/DocumentBody.tsx";
import { Signatories } from "../../participant/components/Signatories.tsx";

/**
 * `specs/screens/public-and-embed.md` § Display Rules "Public read view":
 * the document screen layout minus the status card and identity line, plus
 * `AskTeamCard` in their place. Reuses `DocumentBody` and `Signatories`
 * as-is (`plans/public-and-embed.md` § Approach) — neither reads anything
 * person-specific.
 */
export function PublicDocumentView({
  bundle,
  slug,
}: {
  bundle: PublicBundle;
  slug: string;
}): JSX.Element {
  return (
    <main className="pb-8">
      <PublicDocumentHeader document={bundle.document} />
      <AskTeamCard replyTo={bundle.document.reply_to} />
      <PublicVersionLabel
        slug={slug}
        number={bundle.version.number}
        publishedAt={bundle.version.published_at}
        summary={bundle.version.summary}
      />
      <DocumentBody html={bundle.version.html} />
      <Signatories signatories={bundle.signatories} />
    </main>
  );
}
