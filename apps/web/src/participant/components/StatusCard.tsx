import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { ApiError, deleteSignature, patchSignature, postDecline } from "../api.ts";
import {
  computeCardState,
  currentDraftSubmission,
  signatureDrift,
  signatureTime,
} from "../cardState.ts";
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
  const drift = signatureDrift(bundle);
  const draft = currentDraftSubmission(bundle);
  const [editing, setEditing] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canAct = bundle.document.phase === "commenting" || bundle.document.phase === "signing";
  const canComment = bundle.document.phase === "commenting";
  const signature = bundle.signature;

  // `## Principles`: "every action moves focus somewhere sensible and
  // announces its result in a live region". `headingRef` is attached to
  // whichever panel heading the current `state` renders (only one is
  // mounted at a time); the two effects below move focus there and set the
  // live-region text whenever `state` or `editing` actually changes after
  // the initial render — never on mount, so loading the page never steals
  // focus.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const stateMounted = useRef(false);
  const editingMounted = useRef(false);

  function panelAnnouncement(): string {
    if (state === "signed" || state === "signed_conditional" || state === "signed_final_pending") {
      return signature
        ? copy.signed.announcement(formatAbsolute(signatureTime(signature)), signature)
        : "";
    }
    if (state === "declined") {
      return copy.declined.heading;
    }
    if (state === "not_signed") {
      return signature?.revoked && signature.revoked_at
        ? copy.signForm.removedOn(formatAbsolute(signature.revoked_at))
        : copy.signForm.heading;
    }
    if (state === "closed") {
      return copy.closedCard.heading(formatAbsolute(bundle.document.signing_closes_at));
    }
    return "";
  }

  useEffect(() => {
    if (!stateMounted.current) {
      stateMounted.current = true;
      return;
    }
    setLiveMessage(panelAnnouncement());
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!editingMounted.current) {
      editingMounted.current = true;
      return;
    }
    if (!editing) {
      setLiveMessage(panelAnnouncement());
      headingRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

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

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5"
      aria-label={copy.signForm.heading}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

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
            <SignForm
              bundle={bundle}
              token={token}
              onSigned={refetch}
              readOnly={readOnly}
              headingRef={headingRef}
            />
          </>
        ) : (
          <p className="text-foreground">{copy.closedCard.ownNotSigned}</p>
        )
      ) : null}

      {state === "declined" ? (
        <div className="flex flex-col gap-2">
          <h2
            ref={resigning ? undefined : headingRef}
            tabIndex={resigning ? undefined : -1}
            className="text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {copy.declined.heading}
          </h2>
          {resigning ? (
            <SignForm
              bundle={bundle}
              token={token}
              onSigned={refetch}
              readOnly={readOnly}
              headingRef={headingRef}
            />
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
              document={bundle.document}
              token={token}
              onSaved={async () => {
                // Refetch before closing the form so the heading and live
                // region that appear the instant `editing` flips back to
                // false already reflect the saved values, not the stale
                // pre-save ones.
                await refetch();
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {/*
               * `specs/behaviors/signatures.md` § Conditional signatures:
               * marked for the signer on their own card and for the team in
               * their views; the public list stays uniform.
               */}
              {state === "signed_conditional" ? (
                <p>
                  <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber">
                    {copy.signed.conditionalMarker}
                  </span>
                </p>
              ) : null}

              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {copy.signed.heading}
              </h2>

              {/*
               * § Display Rules 3 (*Signed*): the facts as a short labeled
               * list, one per line — how you are listed, whether your name
               * is on the list, and what you signed and when. A run-on
               * sentence made all three hard to find and the third easy to
               * miss.
               */}
              <dl className="flex flex-col gap-1.5 text-sm">
                <Fact label={copy.signed.listedAsLabel}>{copy.signed.listedAs(signature)}</Fact>

                {/*
                 * § *Your listing status is a fact on the card*, and
                 * `specs/behaviors/signatures.md` § Display. Absent when
                 * `show_signatories` is not `list`: no list is shown to
                 * anyone, so there is nothing to be on or off.
                 */}
                {bundle.document.show_signatories === "list" ? (
                  <Fact label={copy.signed.onTheListLabel}>
                    {signature.listed ? (
                      <span className="text-muted-foreground">
                        {copy.signed.listedYes(bundle.document.audience)}
                      </span>
                    ) : (
                      <span>
                        <span className="font-semibold text-foreground">
                          {copy.signed.listedNoLead}
                        </span>{" "}
                        <span className="text-muted-foreground">{copy.signed.listedNoRest}</span>
                      </span>
                    )}
                  </Fact>
                ) : null}

                <Fact label={copy.signed.signedLabel}>
                  <span className="text-muted-foreground">
                    {copy.signed.signedOn(
                      formatAbsolute(signatureTime(signature)),
                      signature.signed_on_version,
                    )}
                  </span>
                </Fact>
              </dl>

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

              {/*
               * § Display Rules 3, *Behind the current version*: its own
               * quiet line, with the comparison defaulted to the version
               * this signer actually signed rather than whichever version
               * happens to precede the current one.
               */}
              {drift ? (
                <p className="text-sm text-muted-foreground">
                  {copy.signed.textChanged(drift.currentVersion)}{" "}
                  <InertLink
                    readOnly={readOnly}
                    to={`/i/${token}/history/compare?from=${drift.signedVersion}&to=${drift.currentVersion}`}
                    className="font-medium"
                  >
                    {copy.signed.seeWhatChanged}
                  </InertLink>
                </p>
              ) : null}

              {/*
               * § Display Rules 3 (*Signed*), the action row: "one row that
               * wraps as a group with even gaps, every item styled the same
               * quiet way so none of them orphans on a line of its own."
               * "Add comments" used to be the one anchor among buttons,
               * which is exactly why it kept landing alone on a second
               * line; it is a quiet button like the rest now.
               */}
              {canAct ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  {/*
                   * One re-affirmation action, ever: the final version's
                   * "Confirm my signature" stands in for "Keep my name"
                   * when both would otherwise apply.
                   */}
                  {state === "signed_final_pending" || drift ? (
                    <QuietAction
                      onClick={() => void handleConfirmSignature()}
                      disabled={busy || readOnly}
                    >
                      {state === "signed_final_pending"
                        ? copy.signed.confirmButton
                        : copy.signed.keep}
                    </QuietAction>
                  ) : null}
                  <QuietAction disabled={readOnly} onClick={() => setEditing(true)}>
                    {copy.signed.changeListing}
                  </QuietAction>
                  <QuietAction disabled={readOnly} onClick={() => setRemoveOpen(true)}>
                    {copy.signed.remove}
                  </QuietAction>
                  {canComment ? (
                    <QuietAction disabled={readOnly} to={`/i/${token}/comment`}>
                      {copy.signed.addComments}
                    </QuietAction>
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
                  formatAbsolute(signatureTime(signature)),
                  signature.display_name,
                  signature.signed_on_version,
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

      {/*
       * § Design "Links and quiet actions": these two are real destinations
       * on a touch screen, so they carry a 44 px tap target (issue #65 — a
       * ~20 px anchor that a real finger tap kept missing).
       */}
      {state === "not_signed" && canAct ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 text-sm">
          <button
            type="button"
            disabled={readOnly}
            className="inline-flex min-h-11 items-center text-left font-medium text-primary hover:underline disabled:no-underline disabled:opacity-60"
            onClick={() => setDeclineOpen(true)}
          >
            {copy.signForm.declineLink}
          </button>
          <InertLink
            readOnly={readOnly}
            to={`/i/${token}/comment`}
            className="inline-flex min-h-11 items-center font-medium"
          >
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
 * One fact on the signed card: a small muted label and its value, each on
 * its own line (`specs/screens/document.md` § Design "Signed card": "the
 * facts as label-and-value rows with the label small, uppercase and
 * muted").
 */
function Fact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

/**
 * One item in the signed card's action row. Every item is the same quiet
 * control whether it navigates or acts (§ Display Rules 3: "every item
 * styled the same quiet way so none of them orphans on a line of its
 * own"), and `disabled` under view-as is a genuinely disabled button, not a
 * link that merely looks inert (`specs/screens/admin-dashboard.md`).
 */
function QuietAction({
  children,
  to,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}): JSX.Element {
  const className =
    "inline-flex min-h-9 items-center rounded-lg border border-border px-3 font-medium text-primary hover:bg-muted hover:underline disabled:pointer-events-none disabled:no-underline disabled:opacity-60";
  if (to !== undefined && !disabled) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
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
