import { useRef } from "react";

import { DocumentBody } from "./DocumentBody.tsx";
import { DocumentHeader } from "./DocumentHeader.tsx";
import { Footer } from "./Footer.tsx";
import { Signatories } from "./Signatories.tsx";
import { StatusCard } from "./StatusCard.tsx";
import { StickySignBar } from "./StickySignBar.tsx";
import { SubmissionsSection } from "./SubmissionsSection.tsx";
import { VersionLabel } from "./VersionLabel.tsx";
import { copy } from "../copy.ts";
import { type Bundle } from "../types.ts";

/**
 * The document screen's layout, shared by the current-version route
 * (`/i/:token`), the older-version route (`/i/:token/v/:n`) — both are
 * "the same layout" per `specs/screens/document.md` § Route, differing only
 * in which version's `html`/`summary`/`published_at` is shown and whether
 * the older-version banner renders — and the admin "view as" route
 * (`specs/screens/admin-dashboard.md`), which sets `readOnly` to render
 * the same card and the same prefs line with every control disabled —
 * view-as shows the participant's real screen, not a summary of it.
 *
 * § Design "Layout": the action panel is first in DOM order (so it comes
 * first on phones, per "Sign first"), and moves to a sticky right column
 * at `lg` widths; the document and signatories are cards on the left.
 *
 * `## Principles` (#72): the panel staying first in DOM order at `lg`
 * means keyboard users tab through the whole sign form before reaching the
 * document even though it renders on the left. Phones get no such link —
 * the panel-first order there is the intended "Sign first" reading order,
 * not a mismatch — so the skip link is `lg`-only (`max-lg:hidden`),
 * visually hidden until focused like any skip link.
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
          <a
            href="#document-card"
            className="sr-only max-lg:hidden focus-visible:not-sr-only focus-visible:mb-3 focus-visible:block focus-visible:w-fit focus-visible:rounded-lg focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white"
          >
            {copy.skipToDocument}
          </a>
          <StatusCard bundle={bundle} token={token} refetch={refetch} readOnly={readOnly} />
        </aside>

        <div className="min-w-0">
          <section
            id="document-card"
            tabIndex={-1}
            className="rounded-2xl border border-border bg-card p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <VersionLabel
              token={token}
              number={version.number}
              publishedAt={version.published_at}
              summary={version.summary}
              isCurrent={isCurrent}
              currentNumber={bundle.version.number}
              readOnly={readOnly}
            />
            <DocumentBody html={version.html} demoteFirstHeading={readOnly} />
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
