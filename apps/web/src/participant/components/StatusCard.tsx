import { useState } from "react";
import { Link } from "react-router";

import { ApiError, deleteSignature, patchSignature, postDecline } from "../api.ts";
import { computeCardState, currentDraftSubmission } from "../cardState.ts";
import { copy } from "../copy.ts";
import { formatAbsolute } from "../format.ts";
import { type Bundle } from "../types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { EditSignatureForm } from "./EditSignatureForm.tsx";
import { SignForm } from "./SignForm.tsx";

/**
 * The sign card — `specs/screens/document.md` § Display Rules 3, the state
 * machine over `not_signed` / `signed` (+ conditional / final-pending
 * variants) / `declined` / `closed`, always shown above the document text
 * (`## Principles` § Local: "the first sentence a returning participant
 * reads is what they have done and what they can do next").
 */
export function StatusCard({
  bundle,
  token,
  refetch,
}: {
  bundle: Bundle;
  token: string;
  refetch: () => Promise<void>;
}): JSX.Element {
  const state = computeCardState(bundle);
  const draft = currentDraftSubmission(bundle);
  const [editing, setEditing] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canAct = bundle.document.phase === "commenting" || bundle.document.phase === "signing";
  const canComment = bundle.document.phase === "commenting";

  async function handleRemove(reason: string | undefined) {
    setBusy(true);
    setActionError(null);
    try {
      await deleteSignature(token, reason);
      setRemoveOpen(false);
      await refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? copy.phaseClosedMessage(err) : copy.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline(reason: string | undefined) {
    setBusy(true);
    setActionError(null);
    try {
      await postDecline(token, reason);
      setDeclineOpen(false);
      await refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? copy.phaseClosedMessage(err) : copy.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmSignature() {
    setBusy(true);
    setActionError(null);
    try {
      await patchSignature(token, { confirm: true });
      await refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? copy.phaseClosedMessage(err) : copy.genericError);
    } finally {
      setBusy(false);
    }
  }

  const signature = bundle.signature;

  return (
    <section
      className="mx-4 mt-4 rounded-lg border border-border p-4"
      aria-label={copy.signForm.heading}
    >
      {draft ? (
        <p className="mb-2 text-sm text-muted-foreground">
          {copy.draftLine(draft.version)} ·{" "}
          <Link to={`/i/${token}/comment`} className="underline">
            {copy.continueLink}
          </Link>
        </p>
      ) : null}

      {state === "not_signed" ? (
        canAct ? (
          <SignForm bundle={bundle} token={token} onSigned={refetch} />
        ) : (
          <p className="text-foreground">{copy.closedCard.ownNotSigned}</p>
        )
      ) : null}

      {state === "declined" ? (
        <div className="flex flex-col gap-2">
          <p className="text-foreground">{copy.declined.heading}</p>
          {resigning ? (
            <SignForm bundle={bundle} token={token} onSigned={refetch} />
          ) : canAct ? (
            <div>
              <span className="text-muted-foreground">{copy.declined.changedMind} </span>
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => setResigning(true)}
              >
                {copy.declined.signAs(bundle.prefill.name ?? "")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {(state === "signed" || state === "signed_conditional" || state === "signed_final_pending") &&
      signature ? (
        <div className="flex flex-col gap-2">
          {editing ? (
            <EditSignatureForm
              signature={signature}
              token={token}
              onSaved={async () => {
                setEditing(false);
                await refetch();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <p className="text-foreground">
                {copy.signed.heading(
                  formatAbsolute(signature.signed_at ?? signature.resigned_at),
                  signature.display_name,
                  signature.descriptor,
                )}
              </p>

              {state === "signed_conditional" ? (
                <p className="text-sm text-muted-foreground">{copy.signed.conditionalNote}</p>
              ) : null}

              {state === "signed_final_pending" ? (
                <p className="text-sm text-muted-foreground">
                  {copy.signed.finalPublished(
                    formatAbsolute(bundle.versions.find((v) => v.final)?.published_at),
                  )}
                </p>
              ) : null}

              {canAct ? (
                <div className="flex flex-wrap gap-3 text-sm">
                  {state === "signed_final_pending" ? (
                    <button
                      type="button"
                      onClick={() => void handleConfirmSignature()}
                      disabled={busy}
                      className="font-semibold underline"
                    >
                      {copy.signed.confirmButton}
                    </button>
                  ) : null}
                  <button type="button" className="underline" onClick={() => setEditing(true)}>
                    {copy.signed.changeListing}
                  </button>
                  <button type="button" className="underline" onClick={() => setRemoveOpen(true)}>
                    {copy.signed.remove}
                  </button>
                  {canComment ? (
                    <Link to={`/i/${token}/comment`} className="underline">
                      {copy.signed.addComments}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {state === "closed" ? (
        <div className="flex flex-col gap-1">
          <p className="text-foreground">
            {copy.closedCard.heading(formatAbsolute(bundle.document.signing_closes_at))}
          </p>
          <p className="text-muted-foreground">
            {signature && !signature.revoked
              ? copy.closedCard.ownSigned(
                  formatAbsolute(signature.signed_at),
                  signature.display_name,
                )
              : bundle.position?.judgement === "decline"
                ? copy.closedCard.ownDeclined
                : copy.closedCard.ownNotSigned}
          </p>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {state === "not_signed" && canAct ? (
        <div className="mt-2 flex flex-col gap-1 text-sm">
          <button
            type="button"
            className="text-left underline"
            onClick={() => setDeclineOpen(true)}
          >
            {copy.signForm.declineLink}
          </button>
          <Link to={`/i/${token}/comment`} className="underline">
            {copy.signForm.commentLink}
          </Link>
        </div>
      ) : null}

      <ConfirmDialog
        open={removeOpen}
        heading={copy.removeDialog.heading}
        body={copy.removeDialog.body}
        reasonLabel={copy.removeDialog.reasonLabel}
        confirmLabel={copy.removeDialog.confirm}
        cancelLabel={copy.removeDialog.cancel}
        busyLabel={copy.removeDialog.removing}
        busy={busy}
        onConfirm={(reason) => void handleRemove(reason)}
        onCancel={() => setRemoveOpen(false)}
      />
      <ConfirmDialog
        open={declineOpen}
        heading={copy.declineDialog.heading}
        body={copy.declineDialog.body}
        reasonLabel={copy.declineDialog.reasonLabel}
        confirmLabel={copy.declineDialog.confirm}
        cancelLabel={copy.declineDialog.cancel}
        busyLabel={copy.declineDialog.declining}
        busy={busy}
        onConfirm={(reason) => void handleDecline(reason)}
        onCancel={() => setDeclineOpen(false)}
      />
    </section>
  );
}
