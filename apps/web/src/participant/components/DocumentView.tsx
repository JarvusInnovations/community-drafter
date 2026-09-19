import { DocumentBody } from "./DocumentBody.tsx";
import { DocumentHeader } from "./DocumentHeader.tsx";
import { Footer } from "./Footer.tsx";
import { Signatories } from "./Signatories.tsx";
import { StatusCard } from "./StatusCard.tsx";
import { SubmissionsSection } from "./SubmissionsSection.tsx";
import { VersionLabel } from "./VersionLabel.tsx";
import { type Bundle } from "../types.ts";

/**
 * The document screen's layout, shared by the current-version route
 * (`/i/:token`) and the older-version route (`/i/:token/v/:n`) — both are
 * "the same layout" per `specs/screens/document.md` § Route, differing only
 * in which version's `html`/`summary`/`published_at` is shown and whether
 * the older-version banner renders.
 */
export function DocumentView({
  bundle,
  token,
  refetch,
  version,
  isCurrent,
}: {
  bundle: Bundle;
  token: string;
  refetch: () => Promise<void>;
  version: { number: number; summary: string; published_at: string; html: string };
  isCurrent: boolean;
}): JSX.Element {
  return (
    <main className="pb-8">
      <DocumentHeader document={bundle.document} person={bundle.person} />
      <StatusCard bundle={bundle} token={token} refetch={refetch} />
      <VersionLabel
        token={token}
        number={version.number}
        publishedAt={version.published_at}
        summary={version.summary}
        isCurrent={isCurrent}
        currentNumber={bundle.version.number}
      />
      <DocumentBody html={version.html} />
      <SubmissionsSection submissions={bundle.submissions} />
      <Signatories signatories={bundle.signatories} />
      <Footer
        token={token}
        replyTo={bundle.document.reply_to}
        senderName={bundle.document.sender_name}
      />
    </main>
  );
}
