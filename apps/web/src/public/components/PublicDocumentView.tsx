import { copy } from "../copy.ts";
import { AskTeamCard } from "./AskTeamCard.tsx";
import { PublicDocumentHeader } from "./PublicDocumentHeader.tsx";
import { PublicVersionLabel } from "./PublicVersionLabel.tsx";
import { type PublicBundle } from "../types.ts";
import { DocumentBody } from "../../participant/components/DocumentBody.tsx";
import { Signatories } from "../../participant/components/Signatories.tsx";

/**
 * `specs/screens/public-and-embed.md` § "Public read view": the document
 * screen layout without the status card and identity line, with the
 * "ask the team" card in the panel slot. Same frame and cards as the
 * participant view (`specs/screens/document.md` § Design).
 */
export function PublicDocumentView({
  bundle,
  slug,
}: {
  bundle: PublicBundle;
  slug: string;
}): JSX.Element {
  return (
    <main className="mx-auto max-w-[1120px] px-5 pb-10">
      <PublicDocumentHeader document={bundle.document} />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <aside className="min-w-0 lg:sticky lg:top-16 lg:order-2">
          <AskTeamCard replyTo={bundle.document.reply_to} />
        </aside>
        <div className="min-w-0">
          <section className="rounded-2xl border border-border bg-card p-5">
            <PublicVersionLabel
              slug={slug}
              number={bundle.version.number}
              publishedAt={bundle.version.published_at}
              summary={bundle.version.summary}
            />
            <DocumentBody html={bundle.version.html} />
          </section>
          <Signatories signatories={bundle.signatories} />
          {/*
            `specs/screens/public-and-embed.md` § The statement download:
            offered only when `/d/<slug>/statement.pdf` would render rather
            than 404 — which, on a page that is already rendering, comes
            down to the document's audience. On a `closed` one the link is
            absent and nothing here says a download exists.
          */}
          {bundle.document.audience === "public" ? (
            <footer className="mt-9 mb-4 text-sm leading-relaxed text-muted-foreground">
              <a
                href={`/d/${slug}/statement.pdf`}
                className="font-medium text-primary hover:underline"
              >
                {copy.footer.downloadStatement}
              </a>
            </footer>
          ) : null}
        </div>
      </div>
    </main>
  );
}
