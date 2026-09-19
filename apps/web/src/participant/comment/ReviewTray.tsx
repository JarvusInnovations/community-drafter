import { useEffect, useId, useState } from "react";

import { type SubmitInput } from "../api.ts";
import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";
import {
  type Bundle,
  type Capacity,
  type SubmissionJudgement,
  type SubmissionView,
} from "../types.ts";
import { JudgementPicker } from "./JudgementPicker.tsx";
import { TrayItem } from "./TrayItem.tsx";
import { type TrayComment } from "./useDraftTray.ts";

type DisabledReason =
  | "phaseClosed"
  | "noJudgement"
  | "nothingChanged"
  | "unsaved"
  | "needsSignature"
  | null;

function SignatureFields({
  bundle,
  onChange,
}: {
  bundle: Bundle;
  onChange: (value: NonNullable<SubmitInput["signature"]>) => void;
}): JSX.Element {
  const capacities = bundle.document.capacities;
  const [capacity, setCapacity] = useState<Capacity>(
    bundle.prefill.suggested_capacity ?? capacities[0] ?? "personal",
  );
  const [displayName, setDisplayName] = useState(bundle.prefill.name ?? "");
  const [org, setOrg] = useState(bundle.prefill.org ?? "");
  const [title, setTitle] = useState(bundle.prefill.role ?? "");
  const [descriptor, setDescriptor] = useState(bundle.prefill.descriptor ?? "");
  const [authorized, setAuthorized] = useState(false);
  const formId = useId();
  const isOfficial = capacity === "official";

  function emit(next: Partial<Record<string, unknown>> = {}): void {
    onChange({
      capacity,
      display_name: displayName,
      descriptor: isOfficial ? undefined : descriptor || undefined,
      org: isOfficial ? org : undefined,
      title: isOfficial ? title : undefined,
      authorized: isOfficial ? authorized : true,
      listed: true,
      ...next,
    });
  }

  // Prefilled fields (the person's name, in particular) already satisfy
  // "needs a name to sign" — tell the parent about them once on mount
  // rather than only after the participant edits something.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => emit(), []);

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-2.5 text-sm">
      <p className="font-semibold text-foreground">{copy.commentMode.signatureFieldsHeading}</p>
      {capacities.length > 1 ? (
        <fieldset className="flex flex-col gap-1">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${formId}-capacity`}
              checked={capacity === "personal"}
              onChange={() => {
                setCapacity("personal");
                emit({ capacity: "personal" });
              }}
            />
            {copy.signForm.capacityPersonal}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${formId}-capacity`}
              checked={capacity === "official"}
              onChange={() => {
                setCapacity("official");
                emit({ capacity: "official" });
              }}
            />
            {copy.signForm.capacityOfficial}
          </label>
        </fieldset>
      ) : null}

      <label className="flex flex-col gap-1">
        {copy.signForm.nameLabel}
        <input
          type="text"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            emit({ display_name: event.target.value });
          }}
          className="rounded border border-border p-2"
        />
      </label>

      {isOfficial ? (
        <>
          <label className="flex flex-col gap-1">
            {copy.signForm.orgLabel}
            <input
              type="text"
              value={org}
              onChange={(event) => {
                setOrg(event.target.value);
                emit({ org: event.target.value });
              }}
              className="rounded border border-border p-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            {copy.signForm.titleLabel}
            <input
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                emit({ title: event.target.value });
              }}
              className="rounded border border-border p-2"
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(event) => {
                setAuthorized(event.target.checked);
                emit({ authorized: event.target.checked });
              }}
            />
            <span>{copy.signForm.attestation(org)}</span>
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1">
          {copy.signForm.descriptorLabel}
          <input
            type="text"
            value={descriptor}
            onChange={(event) => {
              setDescriptor(event.target.value);
              emit({ descriptor: event.target.value });
            }}
            className="rounded border border-border p-2"
          />
        </label>
      )}
    </div>
  );
}

function EarlierSubmissions({
  submissions,
}: {
  submissions: SubmissionView[];
}): JSX.Element | null {
  const submitted = submissions.filter((submission) => submission.state === "submitted");
  if (submitted.length === 0) {
    return null;
  }

  return (
    <details className="rounded border border-border p-2.5">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        {copy.commentMode.earlierSubmissions.heading}
      </summary>
      <ul className="mt-2 flex flex-col gap-3">
        {submitted.map((submission) => (
          <li key={submission.id} className="text-sm">
            <p className="font-medium text-foreground">
              {copy.submissions.versionLabel(submission.version)} ·{" "}
              {formatAbsolute(submission.submitted_at)} ·{" "}
              {copy.submissions.judgementLabel(submission.judgement)}
            </p>
            {submission.comments.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1 pl-3">
                {submission.comments.map((comment) => (
                  <li key={comment.id} className="text-muted-foreground">
                    <span>{comment.body}</span>
                    {comment.disposition ? (
                      <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs">
                        {copy.submissions.dispositionLabel(comment.disposition.outcome)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export interface ReviewTrayProps {
  bundle: Bundle;
  draftVersion: number | null;
  currentVersion: number;
  phaseCommenting: boolean;
  inlineComments: TrayComment[];
  general: TrayComment | null;
  pendingCount: number;
  focusedId: string | null;
  earlierSubmissions: SubmissionView[];
  onEditComment: (id: string, body: string) => void;
  onCommitComment: (id: string) => void;
  onRemoveComment: (id: string) => void;
  onEditGeneral: (body: string) => void;
  onSubmit: (input: SubmitInput) => Promise<void>;
  submitting: boolean;
}

/**
 * `specs/screens/comment-mode.md` § Review tray. A side panel on wide
 * screens, a bottom sheet on phones — the responsive behavior lives in the
 * Tailwind classes on the wrapping `<aside>` in `CommentModeScreen`; this
 * component is just its content.
 */
export function ReviewTray({
  bundle,
  draftVersion,
  currentVersion,
  phaseCommenting,
  inlineComments,
  general,
  pendingCount,
  focusedId,
  earlierSubmissions,
  onEditComment,
  onCommitComment,
  onRemoveComment,
  onEditGeneral,
  onSubmit,
  submitting,
}: ReviewTrayProps): JSX.Element {
  const [judgement, setJudgement] = useState<SubmissionJudgement | null>(null);
  const [signature, setSignature] = useState<NonNullable<SubmitInput["signature"]> | null>(null);

  const isCurrentSigner = Boolean(bundle.signature && !bundle.signature.revoked);
  const hasComments = inlineComments.length > 0 || Boolean(general?.body.trim());
  const totalCount = inlineComments.length + (general?.body.trim() ? 1 : 0);
  const version = draftVersion ?? currentVersion;

  const needsNewSignature =
    (judgement === "sign" || judgement === "sign_conditional") && !isCurrentSigner;

  let disabledReason: DisabledReason = null;
  if (!phaseCommenting) {
    disabledReason = "phaseClosed";
  } else if (!judgement) {
    disabledReason = "noJudgement";
  } else if (judgement === "comment" && !hasComments) {
    disabledReason = "nothingChanged";
  } else if (pendingCount > 0) {
    disabledReason = "unsaved";
  } else if (needsNewSignature && !signature?.display_name?.trim()) {
    disabledReason = "needsSignature";
  }

  const submitLabel = judgement ? copy.commentMode.submitButton[judgement] : "Submit";

  async function handleSubmit(): Promise<void> {
    if (!judgement || disabledReason) {
      return;
    }
    await onSubmit({
      version,
      judgement,
      pending: pendingCount,
      signature: needsNewSignature && signature ? signature : undefined,
    });
  }

  if (!phaseCommenting) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="text-sm text-foreground">{copy.commentMode.trayHeading(version)}</p>
        <p className="text-sm text-muted-foreground">
          {copy.commentMode.phaseClosed.message(formatAbsolute(bundle.document.comments_close_at))}
        </p>
        <ul className="flex flex-col gap-2">
          {inlineComments.map((comment) => (
            <li key={comment.id} className="rounded border border-border p-2 text-sm">
              {comment.body}
            </li>
          ))}
        </ul>
        <EarlierSubmissions submissions={earlierSubmissions} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {copy.commentMode.trayHeading(version)}
        </h2>
        <p className="text-xs text-muted-foreground">{copy.commentMode.traySummary(totalCount)}</p>
      </div>

      {inlineComments.length === 0 && !general ? (
        <p className="text-sm text-muted-foreground">{copy.commentMode.trayEmpty}</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {inlineComments.map((comment) => (
          <TrayItem
            key={comment.id}
            comment={comment}
            focused={focusedId === comment.id}
            onEdit={(body) => onEditComment(comment.id, body)}
            onCommit={() => onCommitComment(comment.id)}
            onDelete={() => onRemoveComment(comment.id)}
          />
        ))}
      </ul>

      <label className="flex flex-col gap-1 text-sm">
        {copy.commentMode.generalLabel}
        <textarea
          value={general?.body ?? ""}
          placeholder={copy.commentMode.generalPlaceholder}
          onChange={(event) => onEditGeneral(event.target.value)}
          rows={3}
          className="rounded border border-border p-2 text-sm"
        />
      </label>
      {general ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          {copy.commentMode.itemState[general.status]}
        </p>
      ) : null}

      <JudgementPicker
        value={judgement}
        onChange={setJudgement}
        isCurrentSigner={isCurrentSigner}
        hasComments={hasComments}
      />

      {needsNewSignature ? <SignatureFields bundle={bundle} onChange={setSignature} /> : null}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={Boolean(disabledReason) || submitting}
        className="rounded bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
      >
        {submitting ? "…" : submitLabel}
      </button>
      {disabledReason ? (
        <p className="text-xs text-muted-foreground">
          {copy.commentMode.submitDisabledReason[disabledReason]}
        </p>
      ) : null}

      <EarlierSubmissions submissions={earlierSubmissions} />
    </div>
  );
}
