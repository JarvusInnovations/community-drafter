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
        <h1 className="text-lg font-semibold text-foreground">
          {copy.commentMode.confirmation.heading}
        </h1>
        <p className="text-muted-foreground">
          {copy.commentMode.confirmation.body(
            copy.submissions.judgementLabel(confirmation.judgement),
          )}
        </p>
        <Link to={`/i/${token}`} className="underline">
          {copy.commentMode.confirmation.backToDocument}
        </Link>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
        <span>{copy.phase.label(bundle.document.phase)}</span>
        <span className="text-muted-foreground">{signatureLine}</span>
        <Link to={`/i/${token}`} className="underline">
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

      <div className="flex flex-1 flex-col md:flex-row">
        <div className="flex-1">
          <DocumentColumn
            html={html}
            version={effectiveVersion}
            highlightTargets={highlightTargets}
            onAddComment={(anchor, body) => tray.addInline(anchor, body)}
            onHighlightClick={setFocusedId}
          />
        </div>
        <aside className="w-full border-t border-border md:w-96 md:border-l md:border-t-0">
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
            onEditComment={tray.editComment}
            onCommitComment={tray.commitComment}
            onRemoveComment={(id) => void tray.removeComment(id)}
            onEditGeneral={tray.editGeneral}
            onSubmit={handleSubmit}
            submitting={false}
          />
        </aside>
      </div>
    </div>
  );
}
