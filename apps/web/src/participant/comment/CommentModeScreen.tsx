import { type Anchor } from "@community-drafter/shared/browser";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { type SubmitInput, getVersion, postSubmit } from "../api.ts";
import { useParticipantBundle } from "../BundleContext.tsx";
import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";
import { type VersionDetail } from "../types.ts";
import { DocumentColumn } from "./DocumentColumn.tsx";
import { type HighlightTarget } from "./highlights.ts";
import { ReviewTray } from "./ReviewTray.tsx";
import { useDraftTray } from "./useDraftTray.ts";
import { VersionMismatchBar } from "./VersionMismatchBar.tsx";

/**
 * `/i/:token/comment` — `specs/screens/comment-mode.md`: the pull-request
 * review experience for one document. Replaces `CommentPlaceholder.tsx`.
 */
export function CommentModeScreen(): JSX.Element {
  const { bundle, token, refetch } = useParticipantBundle();
  const [confirmation, setConfirmation] = useState<{ judgement: string } | null>(null);
  const [movingVersion, setMovingVersion] = useState(false);
  const [displayedVersionNumber, setDisplayedVersionNumber] = useState<number | null>(null);
  const [displayedVersion, setDisplayedVersion] = useState<VersionDetail | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // § Design "Review tray": on phones the sheet starts collapsed to its
  // handle and header so the document stays readable; it opens on tap,
  // when a comment is added, or when a highlight is tapped.
  const [sheetOpen, setSheetOpen] = useState(false);

  const phaseCommenting = bundle.document.phase === "commenting";
  const effectiveVersion = displayedVersionNumber ?? bundle.version.number;

  const tray = useDraftTray({
    token,
    documentSlug: bundle.document.slug,
    person: bundle.person.id,
    version: effectiveVersion,
    canSave: phaseCommenting,
  });

  // Default to the draft's own version once it's known; otherwise the
  // current version — `specs/screens/comment-mode.md` § Route.
  useEffect(() => {
    if (tray.loading) {
      return;
    }
    if (displayedVersionNumber === null) {
      setDisplayedVersionNumber(tray.draftVersion ?? bundle.version.number);
    }
  }, [tray.loading, tray.draftVersion, bundle.version.number, displayedVersionNumber]);

  useEffect(() => {
    if (displayedVersionNumber === null || displayedVersionNumber === bundle.version.number) {
      setDisplayedVersion(null);
      return;
    }
    let cancelled = false;
    getVersion(token, displayedVersionNumber)
      .then((version) => {
        if (!cancelled) {
          setDisplayedVersion(version);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDisplayedVersion(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, displayedVersionNumber, bundle.version.number]);

  const html = displayedVersion?.html ?? bundle.version.html;

  const highlightTargets = useMemo<HighlightTarget[]>(() => {
    const targets: HighlightTarget[] = [];
    for (const comment of tray.inlineComments) {
      if (comment.anchor) {
        targets.push({ id: comment.id, anchor: comment.anchor, kind: "pending" });
      }
    }
    for (const submission of bundle.submissions) {
      if (submission.state !== "submitted") {
        continue;
      }
      for (const comment of submission.comments) {
        if (comment.anchor) {
          targets.push({ id: comment.id, anchor: comment.anchor as Anchor, kind: "submitted" });
        }
      }
    }
    return targets;
  }, [tray.inlineComments, bundle.submissions]);

  async function handleMoveToCurrent(): Promise<void> {
    setMovingVersion(true);
    try {
      await tray.rebase(bundle.version.number);
      setDisplayedVersionNumber(bundle.version.number);
    } finally {
      setMovingVersion(false);
    }
  }

  async function handleSubmit(input: SubmitInput): Promise<void> {
    await postSubmit(token, input);
    setConfirmation({ judgement: input.judgement });
    await tray.reload();
    await refetch();
  }

  const signatureLine =
    bundle.signature && !bundle.signature.revoked
      ? copy.signed.heading(
          formatAbsolute(bundle.signature.signed_at),
          bundle.signature.display_name,
          bundle.signature.descriptor,
        )
      : bundle.position?.judgement === "decline"
        ? copy.declined.heading
        : copy.closedCard.ownNotSigned;

  if (confirmation) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {copy.commentMode.confirmation.heading}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {copy.commentMode.confirmation.body(
              copy.submissions.judgementLabel(confirmation.judgement),
            )}
          </p>
          <Link to={`/i/${token}`} className="mt-4 inline-block font-medium text-primary">
            {copy.commentMode.confirmation.backToDocument}
          </Link>
        </div>
      </main>
    );
  }

  const isCurrentVersion = effectiveVersion === bundle.version.number;

  return (
    <main className={`mx-auto max-w-[1120px] px-5 lg:pb-10 ${sheetOpen ? "pb-[70vh]" : "pb-28"}`}>
      {/*
       * `specs/screens/comment-mode.md` § Design "Frame": beneath the
       * sticky top bar (`InstanceBar`, rendered by `ParticipantLayout`) a
       * slim second bar holds the version chip, the one-line signature
       * status, and "Back to document" on the right.
       */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-bold " +
              (isCurrentVersion ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground")
            }
          >
            {copy.versionLabel.chip(effectiveVersion, isCurrentVersion)}
          </span>
          <span className="text-muted-foreground">{signatureLine}</span>
        </div>
        <Link to={`/i/${token}`} className="font-medium text-primary">
          {copy.commentMode.backToDocument}
        </Link>
      </div>

      {tray.draftVersion !== null && tray.draftVersion !== bundle.version.number ? (
        <VersionMismatchBar
          draftVersion={tray.draftVersion}
          currentVersion={bundle.version.number}
          onKeep={() => setDisplayedVersionNumber(tray.draftVersion)}
          onMove={() => void handleMoveToCurrent()}
          moving={movingVersion}
        />
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
          <DocumentColumn
            html={html}
            version={effectiveVersion}
            highlightTargets={highlightTargets}
            onAddComment={(anchor, body) => {
              tray.addInline(anchor, body);
              setSheetOpen(true);
            }}
            onHighlightClick={(id) => {
              setFocusedId(id);
              setSheetOpen(true);
            }}
          />
        </section>

        {/*
         * § Design "Review tray": a card, sticky on wide screens (360 px,
         * right column); on narrow screens the same element becomes a
         * fixed bottom sheet — the responsive classes below switch it
         * between the two, so state never has to live in two component
         * instances.
         */}
        <aside
          className="fixed inset-x-0 bottom-0 z-20 max-h-[70vh] rounded-t-2xl border-t border-border bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.16)] lg:sticky lg:top-16 lg:z-auto lg:max-h-none lg:rounded-2xl lg:border lg:shadow-none"
          aria-label={copy.commentMode.trayHeading(tray.draftVersion ?? bundle.version.number)}
        >
          <ReviewTray
            bundle={bundle}
            draftVersion={tray.draftVersion}
            currentVersion={bundle.version.number}
            phaseCommenting={phaseCommenting}
            inlineComments={tray.inlineComments}
            general={tray.general}
            pendingCount={tray.pendingCount}
            focusedId={focusedId}
            earlierSubmissions={bundle.submissions}
            sheetOpen={sheetOpen}
            onToggleSheet={() => setSheetOpen((value) => !value)}
            onEditComment={tray.editComment}
            onCommitComment={tray.commitComment}
            onRemoveComment={(id) => void tray.removeComment(id)}
            onEditGeneral={tray.editGeneral}
            onSubmit={handleSubmit}
            submitting={false}
          />
        </aside>
      </div>
    </main>
  );
}
