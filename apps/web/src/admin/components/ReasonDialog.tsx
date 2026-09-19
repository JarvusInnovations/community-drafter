import { useEffect, useRef, useState } from "react";

/**
 * A reason-required confirmation dialog — used where
 * `specs/screens/admin-dashboard.md` § Actions says "reason required"
 * (revoke signature). Unlike the participant `ConfirmDialog`, the confirm
 * button stays disabled until a non-empty reason is entered.
 */
export function ReasonDialog({
  open,
  heading,
  body,
  reasonLabel,
  confirmLabel,
  cancelLabel,
  busyLabel,
  busy,
  error,
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
  error?: string | null;
  onConfirm: (reason: string) => void;
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
    if (open) {
      setReason("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const trimmed = reason.trim();

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-4 text-foreground backdrop:bg-black/40"
    >
      <h2 className="text-lg font-semibold">{heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <label className="mt-3 block text-sm">
        {reasonLabel}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          required
          className="mt-1 w-full rounded border border-border p-2 text-sm"
        />
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-border px-3 py-1.5 text-sm"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(trimmed)}
          disabled={busy || trimmed.length === 0}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-60"
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
