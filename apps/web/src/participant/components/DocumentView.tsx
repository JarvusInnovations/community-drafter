import { useRef } from "react";

import { DocumentBody } from "./DocumentBody.tsx";
import { DocumentHeader } from "./DocumentHeader.tsx";
import { Footer } from "./Footer.tsx";
import { ReadOnlyStatusCard } from "./ReadOnlyStatusCard.tsx";
import { Signatories } from "./Signatories.tsx";
import { StatusCard } from "./StatusCard.tsx";
import { StickySignBar } from "./StickySignBar.tsx";
import { SubmissionsSection } from "./SubmissionsSection.tsx";
import { VersionLabel } from "./VersionLabel.tsx";
import { type Bundle } from "../types.ts";

/**
 * The document screen's layout, shared by the current-version route
 * (`/i/:token`), the older-version route (`/i/:token/v/:n`) — both are
 * "the same layout" per `specs/screens/document.md` § Route, differing only
 * in which version's `html`/`summary`/`published_at` is shown and whether
 * the older-version banner renders — and the admin "view as" route
 * (`specs/screens/admin-dashboard.md`), which sets `readOnly` to swap the
 * interactive status card and the prefs link for inert equivalents.
 *
 * § Design "Layout": the action panel is first in DOM order (so it comes
 * first on phones, per "Sign first"), and moves to a sticky right column
 * at `lg` widths; the document and signatories are cards on the left.
 */
export function DocumentView({
  bundle,
  token,
  refetch,
  version,
  isCurrent,
  readOnly = false,
}: {
  bundle: Bundle;
  token: string;
  refetch: () => Promise<void>;
  version: { number: number; summary: string; published_at: string; html: string };
  isCurrent: boolean;
  readOnly?: boolean;
}): JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null);
  const phase = bundle.document.phase;
  const canSign =
    !readOnly &&
    !(bundle.signature && !bundle.signature.revoked) &&
    (phase === "commenting" || phase === "signing");

  return (
    <main className="mx-auto max-w-[1120px] px-5 pb-24 lg:pb-10">
      <DocumentHeader document={bundle.document} person={bundle.person} readOnly={readOnly} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <aside ref={panelRef} className="min-w-0 lg:sticky lg:top-16 lg:order-2">
          {readOnly ? (
            <ReadOnlyStatusCard bundle={bundle} />
          ) : (
            <StatusCard bundle={bundle} token={token} refetch={refetch} />
          )}
        </aside>

        <div className="min-w-0">
          <section className="rounded-2xl border border-border bg-card p-5">
            <VersionLabel
              token={token}
              number={version.number}
              publishedAt={version.published_at}
              summary={version.summary}
              isCurrent={isCurrent}
              currentNumber={bundle.version.number}
              readOnly={readOnly}
            />
            <DocumentBody html={version.html} />
          </section>
          <SubmissionsSection submissions={bundle.submissions} />
          <Signatories signatories={bundle.signatories} />
          <Footer
            token={token}
            replyTo={bundle.document.reply_to}
            senderName={bundle.document.sender_name}
            readOnly={readOnly}
          />
        </div>
      </div>

      <StickySignBar
        panelRef={panelRef}
        name={bundle.prefill.name ?? bundle.person.name}
        enabled={canSign}
      />
    </main>
  );
}
