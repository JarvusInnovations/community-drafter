import { type ReactNode, useState } from "react";
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
 *
 * `readOnly` is admin view-as (`specs/screens/admin-dashboard.md` § "View
 * as"): the same card, whole, with every control disabled — the operator
 * is checking the screen a participant will actually be sent, so a
 * summary sentence in its place would hide the one thing view-as exists
 * to show. Links become disabled buttons so the disabled state is real
 * for the keyboard and for assistive technology, not just visual, and no
 * handler in this mode reaches the network.
 */
export function StatusCard({
  bundle,
  token,
  refetch,
  readOnly = false,
}: {
  bundle: Bundle;
  token: string;
  refetch: () => Promise<void>;
  readOnly?: boolean;
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
      className="rounded-2xl border border-border bg-card p-5"
      aria-label={copy.signForm.heading}
    >
      {draft ? (
        <p className="mb-2 text-sm text-muted-foreground">
          {copy.draftLine(draft.version)} ·{" "}
          <InertLink readOnly={readOnly} to={`/i/${token}/comment`} className="font-medium">
            {copy.continueLink}
          </InertLink>
        </p>
      ) : null}

      {state === "not_signed" ? (
        canAct ? (
          <>
            {signature?.revoked && signature.revoked_at ? (
              <p className="mb-2 text-sm text-muted-foreground">
                {copy.signForm.removedOn(formatAbsolute(signature.revoked_at))}
              </p>
            ) : null}
            <SignForm bundle={bundle} token={token} onSigned={refetch} readOnly={readOnly} />
          </>
        ) : (
          <p className="text-foreground">{copy.closedCard.ownNotSigned}</p>
        )
      ) : null}

      {state === "declined" ? (
        <div className="flex flex-col gap-2">
          <p className="text-foreground">{copy.declined.heading}</p>
          {resigning ? (
            <SignForm bundle={bundle} token={token} onSigned={refetch} readOnly={readOnly} />
          ) : canAct ? (
            <div>
              <span className="text-muted-foreground">{copy.declined.changedMind} </span>
              <button
                type="button"
                disabled={readOnly}
                className="font-semibold text-primary hover:underline disabled:no-underline disabled:opacity-60"
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
                      disabled={busy || readOnly}
                      className="font-semibold text-primary hover:underline disabled:no-underline disabled:opacity-60"
                    >
                      {copy.signed.confirmButton}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={readOnly}
                    className="font-medium text-primary hover:underline disabled:no-underline disabled:opacity-60"
                    onClick={() => setEditing(true)}
                  >
                    {copy.signed.changeListing}
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    className="font-medium text-primary hover:underline disabled:no-underline disabled:opacity-60"
                    onClick={() => setRemoveOpen(true)}
                  >
                    {copy.signed.remove}
                  </button>
                  {canComment ? (
                    <InertLink
                      readOnly={readOnly}
                      to={`/i/${token}/comment`}
                      className="font-medium"
                    >
                      {copy.signed.addComments}
                    </InertLink>
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
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button
            type="button"
            disabled={readOnly}
            className="text-left font-medium text-primary hover:underline disabled:no-underline disabled:opacity-60"
            onClick={() => setDeclineOpen(true)}
          >
            {copy.signForm.declineLink}
          </button>
          <InertLink readOnly={readOnly} to={`/i/${token}/comment`} className="font-medium">
            {copy.signForm.commentLink}
          </InertLink>
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

/**
 * A navigation link that becomes a genuinely disabled button under
 * view-as, so "every action control is disabled"
 * (`specs/screens/admin-dashboard.md`) holds for the keyboard and for a
 * screen reader, not only visually.
 */
function InertLink({
  readOnly,
  to,
  className,
  children,
}: {
  readOnly: boolean;
  to: string;
  className: string;
  children: ReactNode;
}): JSX.Element {
  if (readOnly) {
    return (
      <button type="button" disabled className={`${className} text-primary opacity-60`}>
        {children}
      </button>
    );
  }
  return (
    <Link to={to} className={`${className} text-primary hover:underline`}>
      {children}
    </Link>
  );
}
