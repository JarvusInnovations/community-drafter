import { useEffect, useState } from "react";

import { inputClass, primaryButtonClass, quietButtonClass } from "../styles.ts";
import { DialogShell } from "./DialogShell.tsx";

/**
 * A reason-required confirmation dialog — used where
 * `specs/screens/admin-dashboard.md` § Actions says "reason required"
 * (revoke signature). Unlike `ConfirmDialog`, the confirm button stays
 * disabled until a non-empty reason is entered.
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
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  const trimmed = reason.trim();

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
          <button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={busy || trimmed.length === 0}
            className={primaryButtonClass}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{body}</p>
      <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
        {reasonLabel}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          required
          className={inputClass}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </DialogShell>
  );
}
