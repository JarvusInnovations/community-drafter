import { useEffect, useState } from "react";

import { ApiError, createOperator, updateOperator } from "../api.ts";
import { copy } from "../copy.ts";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  quietButtonClass,
  selectClass,
} from "../styles.ts";
import { type OperatorRecord } from "../types.ts";
import { DialogShell } from "./DialogShell.tsx";

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
  const isEdit = Boolean(operator);
  const [email, setEmail] = useState(operator?.email ?? "");
  const [name, setName] = useState(operator?.name ?? "");
  const [kind, setKind] = useState<"person" | "bot">(operator?.kind ?? "person");
  const [title, setTitle] = useState(operator?.title ?? "");
  const [org, setOrg] = useState(operator?.org ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(operator?.email ?? "");
      setName(operator?.name ?? "");
      setKind(operator?.kind ?? "person");
      setTitle(operator?.title ?? "");
      setOrg(operator?.org ?? "");
      setError(null);
    }
  }, [open, operator]);

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
    <DialogShell
      open={open}
      onClose={onClose}
      title={isEdit ? copy.operators.edit : copy.operators.add}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={quietButtonClass}>
            {copy.operators.cancel}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={
              busy || (!isEdit && (!email.trim() || !name.trim())) || (isEdit && !name.trim())
            }
            className={primaryButtonClass}
          >
            {copy.operators.save}
          </button>
        </>
      }
    >
      {!isEdit ? (
        <label className={labelClass}>
          {copy.operators.emailLabel}
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </label>
      ) : null}

      <label className={labelClass}>
        {copy.operators.nameLabel}
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </label>

      {!isEdit ? (
        <label className={labelClass}>
          {copy.operators.kindLabel}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as "person" | "bot")}
            className={selectClass}
          >
            <option value="person">person</option>
            <option value="bot">bot</option>
          </select>
        </label>
      ) : null}

      <label className={labelClass}>
        {copy.operators.titleLabel}
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        {copy.operators.orgLabel}
        <input
          type="text"
          value={org}
          onChange={(event) => setOrg(event.target.value)}
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
