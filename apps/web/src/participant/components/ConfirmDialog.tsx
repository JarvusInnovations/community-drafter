import { useEffect, useRef, useState } from "react";

/**
 * Generic confirmation dialog with an optional reason field, used for both
 * "Remove my name" and "I'd rather not sign" (`specs/screens/document.md` §
 * Actions: both take "an optional reason"). Native `<dialog>` gives focus
 * trapping, `Escape`-to-cancel and a backdrop for free.
 */
export function ConfirmDialog({
  open,
  heading,
  body,
  reasonLabel,
  confirmLabel,
  cancelLabel,
  busyLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  heading: string;
  body: string;
  reasonLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  busyLabel: string;
  busy: boolean;
  onConfirm: (reason: string | undefined) => void;
  onCancel: () => void;
}): JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");

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
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <h2 className="text-lg font-bold tracking-tight">{heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <label className="mt-3 block text-sm font-semibold text-muted-foreground">
        {reasonLabel}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-border bg-card p-2.5 text-sm font-normal text-foreground"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim().length > 0 ? reason.trim() : undefined)}
          disabled={busy}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
