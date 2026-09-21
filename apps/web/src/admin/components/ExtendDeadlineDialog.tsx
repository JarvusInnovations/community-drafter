import { useEffect, useState } from "react";

import { ApiError, extendDeadline } from "../api.ts";
import { copy } from "../copy.ts";
import { inputClass, labelClass, primaryButtonClass, quietButtonClass } from "../styles.ts";
import { type DocumentDetail } from "../types.ts";
import { DialogShell } from "./DialogShell.tsx";
import { formatAbsolute } from "../../participant/format.ts";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInputValue(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `specs/screens/admin-dashboard.md` § Actions: "Extend deadline | dialog
 * with new time (must be later); records and announces per lifecycle."
 * Shows the `deadline_not_later` message on that specific rejection, and
 * the resulting commit on success (`plans/admin-dashboard.md` § Approach).
 */
export function ExtendDeadlineDialog({
  open,
  document,
  onClose,
  onExtended,
}: {
  open: boolean;
  document: DocumentDetail;
  onClose: () => void;
  onExtended: () => void;
}): JSX.Element | null {
  const [comments, setComments] = useState(toLocalInputValue(document.comments_close_at));
  const [signing, setSigning] = useState(toLocalInputValue(document.signing_closes_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setComments(toLocalInputValue(document.comments_close_at));
      setSigning(toLocalInputValue(document.signing_closes_at));
      setError(null);
      setSuccess(null);
    }
  }, [open, document.comments_close_at, document.signing_closes_at]);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const oldComments = document.comments_close_at;
      const oldSigning = document.signing_closes_at;
      const body: { comments_close_at?: string; signing_closes_at?: string } = {};
      if (comments) {
        body.comments_close_at = new Date(comments).toISOString();
      }
      if (signing) {
        body.signing_closes_at = new Date(signing).toISOString();
      }
      const updated = await extendDeadline(document.slug, body);
      const parts: string[] = [];
      if (updated.comments_close_at && updated.comments_close_at !== oldComments) {
        parts.push(
          `comments: ${oldComments ? formatAbsolute(oldComments) : "—"} → ${formatAbsolute(updated.comments_close_at)}`,
        );
      }
      if (updated.signing_closes_at && updated.signing_closes_at !== oldSigning) {
        parts.push(
          `signing: ${oldSigning ? formatAbsolute(oldSigning) : "—"} → ${formatAbsolute(updated.signing_closes_at)}`,
        );
      }
      setSuccess(
        `Extended (${parts.join(", ") || "no change"}). Commit: ${updated.commit ?? "(none)"}`,
      );
      onExtended();
    } catch (err) {
      if (err instanceof ApiError && err.code === "deadline_not_later") {
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : copy.genericError);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={copy.extendDeadline.heading}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={quietButtonClass}>
            {copy.extendDeadline.cancel}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy}
            className={primaryButtonClass}
          >
            {busy ? copy.extendDeadline.submitting : copy.extendDeadline.submit}
          </button>
        </>
      }
    >
      <label className={labelClass}>
        {copy.extendDeadline.commentsLabel}
        <input
          type="datetime-local"
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {copy.extendDeadline.signingLabel}
        <input
          type="datetime-local"
          value={signing}
          onChange={(event) => setSigning(event.target.value)}
          className={inputClass}
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 text-sm font-medium text-ok">
          {success}
        </p>
      ) : null}
    </DialogShell>
  );
}
