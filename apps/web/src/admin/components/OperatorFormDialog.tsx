import { useEffect, useRef, useState } from "react";

import { ApiError, createOperator, updateOperator } from "../api.ts";
import { copy } from "../copy.ts";
import { type OperatorRecord } from "../types.ts";

/**
 * Add/edit form for `/admin/operators` (`specs/screens/admin-dashboard.md`
 * § Operators). Editing never touches `active` — that's the dedicated
 * deactivate/reactivate action on the row, kept separate per the spec's own
 * "add / edit / deactivate / remove" list of four distinct actions.
 */
export function OperatorFormDialog({
  open,
  operator,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Present for edit, absent for add. */
  operator?: OperatorRecord;
  onClose: () => void;
  /** Called with the mutation's commit hash once it succeeds — the parent shows it, e.g. as a banner. */
  onSaved: (commit: string | null) => void;
}): JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);
  const isEdit = Boolean(operator);
  const [email, setEmail] = useState(operator?.email ?? "");
  const [name, setName] = useState(operator?.name ?? "");
  const [kind, setKind] = useState<"person" | "bot">(operator?.kind ?? "person");
  const [title, setTitle] = useState(operator?.title ?? "");
  const [org, setOrg] = useState(operator?.org ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setEmail(operator?.email ?? "");
      setName(operator?.name ?? "");
      setKind(operator?.kind ?? "person");
      setTitle(operator?.title ?? "");
      setOrg(operator?.org ?? "");
      setError(null);
    }
  }, [open, operator]);

  if (!open) {
    return null;
  }

  async function handleSubmit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result =
        isEdit && operator
          ? await updateOperator(operator.email, {
              name: name.trim() || undefined,
              title: title.trim() || undefined,
              org: org.trim() || undefined,
            })
          : await createOperator({
              email: email.trim(),
              name: name.trim(),
              kind,
              title: title.trim() || undefined,
              org: org.trim() || undefined,
            });
      onSaved(result.commit ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.genericError);
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
      <h2 className="text-lg font-semibold">{isEdit ? copy.operators.edit : copy.operators.add}</h2>

      {!isEdit ? (
        <label className="mt-3 block text-sm">
          {copy.operators.emailLabel}
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border border-border p-2 text-sm"
          />
        </label>
      ) : null}

      <label className="mt-3 block text-sm">
        {copy.operators.nameLabel}
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded border border-border p-2 text-sm"
        />
      </label>

      {!isEdit ? (
        <label className="mt-3 block text-sm">
          {copy.operators.kindLabel}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as "person" | "bot")}
            className="mt-1 w-full rounded border border-border p-2 text-sm"
          >
            <option value="person">person</option>
            <option value="bot">bot</option>
          </select>
        </label>
      ) : null}

      <label className="mt-3 block text-sm">
        {copy.operators.titleLabel}
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 w-full rounded border border-border p-2 text-sm"
        />
      </label>

      <label className="mt-3 block text-sm">
        {copy.operators.orgLabel}
        <input
          type="text"
          value={org}
          onChange={(event) => setOrg(event.target.value)}
          className="mt-1 w-full rounded border border-border p-2 text-sm"
        />
      </label>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded border border-border px-3 py-1.5 text-sm"
        >
          {copy.operators.cancel}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={
            busy || (!isEdit && (!email.trim() || !name.trim())) || (isEdit && !name.trim())
          }
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-60"
        >
          {copy.operators.save}
        </button>
      </div>
    </dialog>
  );
}
