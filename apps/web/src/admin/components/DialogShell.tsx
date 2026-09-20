import { type ReactNode, useEffect, useRef } from "react";

/**
 * `specs/screens/admin-dashboard.md` § Design "Dialogs": "centered modal
 * cards with a bold title ... a primary confirm and a quiet cancel." The
 * four admin dialogs (`ConfirmDialog`, `ReasonDialog`, `ExtendDeadlineDialog`,
 * `OperatorFormDialog`) share this frame — the native `<dialog>` element,
 * its show/close lifecycle, and the card chrome — and supply only their own
 * body and footer buttons.
 */
export function DialogShell({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
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
      onClose={onClose}
      className="fixed inset-0 m-auto h-fit w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
      <div className="mt-5 flex justify-end gap-2">{footer}</div>
    </dialog>
  );
}
