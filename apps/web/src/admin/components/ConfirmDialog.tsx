import { useEffect, useRef } from "react";

/**
 * A plain yes/no confirmation dialog — used wherever
 * `specs/screens/admin-dashboard.md` asks for "a confirmation" with no
 * reason attached (deactivate/remove an operator, remove a document
 * operator). `ReasonDialog` is the sibling for the one action that needs a
 * reason (revoke signature).
 */
export function ConfirmDialog({
  open,
  heading,
  body,
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
  confirmLabel: string;
  cancelLabel: string;
  busyLabel: string;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);

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
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-4 text-foreground backdrop:bg-black/40"
    >
      <h2 className="text-lg font-semibold">{heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
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
          onClick={onConfirm}
          disabled={busy}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-60"
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
