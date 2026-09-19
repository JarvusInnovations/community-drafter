import { useEffect, useRef, useState } from "react";

import { ApiError, extendDeadline } from "../api.ts";
import { copy } from "../copy.ts";
import { type DocumentDetail } from "../types.ts";

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
  const ref = useRef<HTMLDialogElement>(null);
  const [comments, setComments] = useState(toLocalInputValue(document.comments_close_at));
  const [signing, setSigning] = useState(toLocalInputValue(document.signing_closes_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
    if (open) {
      setComments(toLocalInputValue(document.comments_close_at));
      setSigning(toLocalInputValue(document.signing_closes_at));
      setError(null);
      setSuccess(null);
    }
  }, [open, document.comments_close_at, document.signing_closes_at]);

  if (!open) {
    return null;
  }

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
          `comments: ${oldComments ? new Date(oldComments).toLocaleString() : "—"} → ${new Date(updated.comments_close_at).toLocaleString()}`,
        );
      }
      if (updated.signing_closes_at && updated.signing_closes_at !== oldSigning) {
        parts.push(
          `signing: ${oldSigning ? new Date(oldSigning).toLocaleString() : "—"} → ${new Date(updated.signing_closes_at).toLocaleString()}`,
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
    <dialog
      ref={ref}
      onClose={onClose}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-4 text-foreground backdrop:bg-black/40"
    >
      <h2 className="text-lg font-semibold">{copy.extendDeadline.heading}</h2>
      <label className="mt-3 block text-sm">
        {copy.extendDeadline.commentsLabel}
        <input
          type="datetime-local"
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          className="mt-1 w-full rounded border border-border p-2 text-sm"
        />
      </label>
      <label className="mt-3 block text-sm">
        {copy.extendDeadline.signingLabel}
        <input
          type="datetime-local"
          value={signing}
          onChange={(event) => setSigning(event.target.value)}
          className="mt-1 w-full rounded border border-border p-2 text-sm"
        />
      </label>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="mt-3 text-sm text-foreground">
          {success}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded border border-border px-3 py-1.5 text-sm"
        >
          {copy.extendDeadline.cancel}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={busy}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
        >
          {busy ? copy.extendDeadline.submitting : copy.extendDeadline.submit}
        </button>
      </div>
    </dialog>
  );
}
