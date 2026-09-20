import { primaryButtonClass, quietButtonClass } from "../styles.ts";
import { DialogShell } from "./DialogShell.tsx";

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
  return (
    <DialogShell
      open={open}
      onClose={onCancel}
      title={heading}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className={quietButtonClass}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={primaryButtonClass}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{body}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </DialogShell>
  );
}
